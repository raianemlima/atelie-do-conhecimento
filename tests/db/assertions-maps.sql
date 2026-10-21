\set ON_ERROR_STOP on
\set A '\'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\''
\set B '\'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\''
grant all on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

set role authenticated; select set_config('request.jwt.claim.sub', :A, false);
insert into public.notebooks(id, name) values ('b0000000-0000-4000-8000-0000000000e1', 'Caderno com mapa');
insert into public.jobs(id, notebook_id, input_hash) values ('c0000000-0000-4000-8000-0000000000e1', 'b0000000-0000-4000-8000-0000000000e1', 'map-job-1'), ('c0000000-0000-4000-8000-0000000000e2', 'b0000000-0000-4000-8000-0000000000e1', 'map-job-2');

do $$ declare r1 public.thematic_maps; r2 public.thematic_maps; r3 public.thematic_maps; n int; begin
  r1 := public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', null, null, 'auto', 'Disc', '{"nodes":[]}', '[]');
  r2 := public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', null, null, 'auto', 'Disc', '{"nodes":["outro"]}', '[]');
  if r1.id <> r2.id or r1.version <> 1 then raise exception 'FALHA: salvar o mapa do mesmo job duas vezes deveria devolver a mesma versão (% vs %)', r1.version, r2.version; end if;
  if r2.map <> '{"nodes":[]}'::jsonb then raise exception 'FALHA: a versão existente foi sobrescrita'; end if;
  r3 := public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', null, 1, 1, 'edited', 'Disc', '{"nodes":["editado"]}', '["Renomeado"]');
  if r3.version <> 2 or r3.base_version <> 1 or r3.status <> 'draft' or r3.origin <> 'edited' then raise exception 'FALHA: versão editada incorreta'; end if;
  begin
    perform public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', null, 1, 1, 'edited', 'Disc', '{}', '[]');
    raise exception 'FALHA: edição sobre versão desatualizada foi aceita';
  exception when others then if sqlerrm <> 'stale_map' then raise; end if; end;
  select count(*) into n from public.thematic_maps where notebook_id = 'b0000000-0000-4000-8000-0000000000e1';
  if n <> 2 then raise exception 'FALHA: esperava 2 versões, há %', n; end if;
end $$;
\echo 'OK  mapas: versão automática idempotente por job, edição cria nova versão, versão antiga imutável, edição desatualizada recusada'

do $$ declare r public.thematic_maps; n int; begin
  r := public.confirm_thematic_map('b0000000-0000-4000-8000-0000000000e1', 1);
  if r.status <> 'confirmed' or r.confirmed_at is null then raise exception 'FALHA: confirmação não registrada'; end if;
  r := public.confirm_thematic_map('b0000000-0000-4000-8000-0000000000e1', 2);
  select count(*) into n from public.thematic_maps where notebook_id = 'b0000000-0000-4000-8000-0000000000e1' and status = 'confirmed';
  if n <> 1 or (select status from public.thematic_maps where notebook_id = 'b0000000-0000-4000-8000-0000000000e1' and version = 1) <> 'draft' then raise exception 'FALHA: deveria haver uma única versão confirmada (%)', n; end if;
  begin
    perform public.confirm_thematic_map('b0000000-0000-4000-8000-0000000000e1', 99);
    raise exception 'FALHA: confirmou versão inexistente';
  exception when others then if sqlerrm <> 'map_not_found' then raise; end if; end;
  begin
    insert into public.thematic_maps(notebook_id, source_job_id, version, origin, map) values ('b0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-4000-8000-0000000000e1', 9, 'auto', '{}');
    raise exception 'FALHA: aceitou dois mapas automáticos para o mesmo job';
  exception when unique_violation then null; end;
  begin
    insert into public.thematic_maps(notebook_id, version, origin, status, map) values ('b0000000-0000-4000-8000-0000000000e1', 8, 'edited', 'confirmed', '{}');
    raise exception 'FALHA: aceitou duas versões confirmadas';
  exception when unique_violation then null; end;
end $$;
\echo 'OK  mapas: uma única versão confirmada por caderno (a anterior volta a rascunho), versão inexistente e duplicatas recusadas'

reset role; set role authenticated; select set_config('request.jwt.claim.sub', :B, false);
do $$ declare n int; begin
  select count(*) into n from public.thematic_maps; if n <> 0 then raise exception 'FALHA: B vê mapas de A'; end if;
  update public.thematic_maps set status = 'draft'; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHA: B alterou mapa de A'; end if;
  -- Com controle de versão: B não enxerga as versões de A, então a versão esperada não confere.
  begin
    perform public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', null, 2, 2, 'edited', 'x', '{}', '[]');
    raise exception 'FALHA: B gravou versão no caderno de A (com controle de versão)';
  exception when others then if sqlerrm <> 'stale_map' then raise; end if; end;
  -- Sem controle de versão: a política de linha bloqueia a gravação em caderno alheio.
  begin
    perform public.save_thematic_map('b0000000-0000-4000-8000-0000000000e1', null, null, null, 'edited', 'x', '{}', '[]');
    raise exception 'FALHA: B gravou versão no caderno de A (sem controle de versão)';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    perform public.confirm_thematic_map('b0000000-0000-4000-8000-0000000000e1', 1);
    raise exception 'FALHA: B confirmou mapa de A';
  exception when others then if sqlerrm not in ('map_not_found') and sqlstate <> 'P0002' then raise; end if; end;
end $$;
\echo 'OK  mapas: isolamento por RLS (leitura, alteração, gravação e confirmação por outro usuário)'
