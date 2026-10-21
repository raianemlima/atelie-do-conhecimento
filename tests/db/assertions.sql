\set ON_ERROR_STOP on
\set A '\'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\''
\set B '\'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\''
insert into auth.users(id, email) values (:A, 'a@test'), (:B, 'b@test');
grant all on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Dados do usuário A (como o próprio A, sob RLS)
set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
insert into public.projects(id, name) values ('a0000000-0000-4000-8000-000000000001', 'Projeto A');
insert into public.documents(id, title, file_name, format, size, sha256, extraction_status, storage_path)
  values ('d0000000-0000-4000-8000-0000000000a1', 'Doc A', 'a.pdf', 'pdf', 10, 'hashA', 'text', 'path/a');
insert into public.notebooks(id, name) values ('b0000000-0000-4000-8000-0000000000a1', 'Caderno A');
insert into public.notebook_sources(notebook_id, document_id) values ('b0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.jobs(id, notebook_id, input_hash) values ('c0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000a1', 'h1');
insert into public.job_stages(id, job_id, stage, subject_id, position)
  values ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a1', 'extraction', 'd0000000-0000-4000-8000-0000000000a1', 1),
         ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000a1', 'cleaning', 'd0000000-0000-4000-8000-0000000000a1', 2);
insert into public.stage_cache(stage, input_hash, output) values ('extraction', 'x', '{"ok":true}');

-- ISOLAMENTO: B não enxerga nem altera nada de A
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
do $$ declare n int; begin
  select count(*) into n from public.notebooks; if n <> 0 then raise exception 'FALHA: B vê cadernos de A (%)', n; end if;
  select count(*) into n from public.jobs; if n <> 0 then raise exception 'FALHA: B vê jobs de A'; end if;
  select count(*) into n from public.job_stages; if n <> 0 then raise exception 'FALHA: B vê estágios de A'; end if;
  select count(*) into n from public.stage_cache; if n <> 0 then raise exception 'FALHA: B vê cache de A'; end if;
  select count(*) into n from public.notebook_sources; if n <> 0 then raise exception 'FALHA: B vê fontes de A'; end if;
  update public.jobs set status = 'cancelled'; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHA: B alterou job de A'; end if;
  begin
    insert into public.jobs(notebook_id, input_hash) values ('b0000000-0000-4000-8000-0000000000a1', 'evil');
    raise exception 'FALHA: B criou job em caderno de A';
  exception when insufficient_privilege or check_violation then null; end;
  insert into public.notebooks(id, name) values ('b0000000-0000-4000-8000-0000000000b1', 'Caderno B');
  begin
    insert into public.notebook_sources(notebook_id, document_id) values ('b0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000a1');
    raise exception 'FALHA: B anexou documento de A ao próprio caderno';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    insert into public.notebooks(name, project_id) values ('x', 'a0000000-0000-4000-8000-000000000001');
    raise exception 'FALHA: B usou projeto de A';
  exception when insufficient_privilege or check_violation then null; end;
  select count(*) into n from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60); if n <> 0 then raise exception 'FALHA: B reivindicou etapa de A'; end if;
end $$;
\echo 'OK  isolamento por RLS (leitura, escrita, vínculos cruzados, claim)'

-- CLAIM: ordem estrita, lease, tentativas (como A)
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
do $$ declare r public.job_stages; n int; begin
  select * into r from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if r.id is distinct from 'e0000000-0000-4000-8000-000000000001' or r.status <> 'running' or r.attempts <> 1 then raise exception 'FALHA: primeiro claim incorreto (% % %)', r.id, r.status, r.attempts; end if;
  select count(*) into n from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if n <> 0 then raise exception 'FALHA: etapa com lease ativa foi reivindicada de novo'; end if;
  update public.job_stages set lease_expires_at = now() - interval '1 second' where id = 'e0000000-0000-4000-8000-000000000001';
  select * into r from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if r.attempts <> 2 then raise exception 'FALHA: reclaim após lease expirada não incrementou tentativas (%)', r.attempts; end if;
  update public.job_stages set status = 'pending', next_attempt_at = now() + interval '1 hour', lease_expires_at = null where id = 'e0000000-0000-4000-8000-000000000001';
  select count(*) into n from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if n <> 0 then raise exception 'FALHA: backoff ignorado (next_attempt_at no futuro)'; end if;
  update public.job_stages set status = 'pending', next_attempt_at = now() - interval '1 second' where id = 'e0000000-0000-4000-8000-000000000001';
  select * into r from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  update public.job_stages set status = 'succeeded', lease_expires_at = null where id = 'e0000000-0000-4000-8000-000000000001';
  select * into r from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if r.id is distinct from 'e0000000-0000-4000-8000-000000000002' then raise exception 'FALHA: ordem estrita violada (esperava etapa 2)'; end if;
  update public.job_stages set lease_expires_at = now() - interval '1 second', attempts = max_attempts where id = r.id;
  select count(*) into n from public.claim_next_stage('c0000000-0000-4000-8000-0000000000a1', 60);
  if n <> 0 or (select status from public.job_stages where id = r.id) <> 'failed' then raise exception 'FALHA: etapa que esgotou tentativas não foi marcada como failed'; end if;
end $$;
\echo 'OK  claim_next_stage: ordem estrita, lease, reclaim, backoff e limite de tentativas'

-- IDEMPOTÊNCIA e unicidade
do $$ begin
  begin
    insert into public.jobs(notebook_id, input_hash) values ('b0000000-0000-4000-8000-0000000000a1', 'h1');
    raise exception 'FALHA: job duplicado (mesmo caderno e hash ativo) foi aceito';
  exception when unique_violation then null; end;
  update public.jobs set status = 'failed' where id = 'c0000000-0000-4000-8000-0000000000a1';
  insert into public.jobs(notebook_id, input_hash) values ('b0000000-0000-4000-8000-0000000000a1', 'h1');
  begin
    insert into public.job_stages(job_id, stage, subject_id, position) select id, 'fusion', null, 1 from public.jobs where status = 'queued';
    insert into public.job_stages(job_id, stage, subject_id, position) select id, 'fusion', null, 2 from public.jobs where status = 'queued';
    raise exception 'FALHA: estágio de caderno (subject nulo) duplicado foi aceito';
  exception when unique_violation then null; end;
end $$;
\echo 'OK  idempotência (job por conteúdo) e unicidade de estágios (inclusive subject nulo)'
