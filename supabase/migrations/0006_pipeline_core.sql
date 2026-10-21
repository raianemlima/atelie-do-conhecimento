-- FASE 2 (NÃO APLICADA). Aplicar somente em ambiente de desenvolvimento/branch de banco e com autorização.
-- Modelo do pipeline em estágios: cadernos, fontes do caderno, jobs, estágios, cache por hash, versões e blocos.
-- Independente da 0005. Reversão: 0006_pipeline_core.down.sql.

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  discipline text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notebook_sources (
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (notebook_id, document_id)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  kind text not null default 'build_notebook',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_hash text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Idempotência: o mesmo conteúdo no mesmo caderno não gera dois jobs ativos ou concluídos.
create unique index if not exists jobs_notebook_input_active_idx on public.jobs(notebook_id, input_hash) where status in ('queued', 'running', 'succeeded');

create table if not exists public.job_stages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage text not null check (stage in ('extraction', 'cleaning', 'segmentation', 'thematic_map', 'citation_registry', 'fusion', 'drafting', 'verification', 'export')),
  subject_id uuid,
  position integer not null check (position > 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  input_hash text,
  output jsonb,
  cache_hit boolean not null default false,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  unique (job_id, position)
);
create unique index if not exists job_stages_unique_subject_idx on public.job_stages(job_id, stage, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.stage_cache (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stage text not null,
  input_hash text not null,
  output jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, stage, input_hash)
);

create table if not exists public.notebook_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  number integer not null check (number > 0),
  status text not null default 'draft' check (status in ('draft', 'ready', 'failed')),
  score numeric(5, 2),
  created_at timestamptz not null default now(),
  unique (notebook_id, number)
);

-- Rastreabilidade invisível: source_refs liga o bloco às fontes/páginas; nunca aparece no texto.
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  version_id uuid not null references public.notebook_versions(id) on delete cascade,
  position integer not null check (position > 0),
  kind text not null default 'paragraph',
  content text not null default '',
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (version_id, position)
);

alter table public.notebooks enable row level security;
alter table public.notebook_sources enable row level security;
alter table public.jobs enable row level security;
alter table public.job_stages enable row level security;
alter table public.stage_cache enable row level security;
alter table public.notebook_versions enable row level security;
alter table public.blocks enable row level security;

-- Cada linha pertence a um dono e só pode apontar para pais do MESMO dono.
create policy "owner notebooks" on public.notebooks for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (project_id is null or project_id in (select id from public.projects where owner_id = (select auth.uid()))));

create policy "owner notebook_sources" on public.notebook_sources for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
    and notebook_id in (select id from public.notebooks where owner_id = (select auth.uid()))
    and document_id in (select id from public.documents where owner_id = (select auth.uid())));

create policy "owner jobs" on public.jobs for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and notebook_id in (select id from public.notebooks where owner_id = (select auth.uid())));

create policy "owner job_stages" on public.job_stages for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and job_id in (select id from public.jobs where owner_id = (select auth.uid())));

create policy "owner stage_cache" on public.stage_cache for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "owner notebook_versions" on public.notebook_versions for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and notebook_id in (select id from public.notebooks where owner_id = (select auth.uid())));

create policy "owner blocks" on public.blocks for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
    and notebook_id in (select id from public.notebooks where owner_id = (select auth.uid()))
    and version_id in (select id from public.notebook_versions where owner_id = (select auth.uid())));

create index if not exists job_stages_job_position_idx on public.job_stages(job_id, position);
create index if not exists jobs_owner_status_idx on public.jobs(owner_id, status);
create index if not exists notebook_sources_document_idx on public.notebook_sources(document_id);
create index if not exists blocks_version_idx on public.blocks(version_id, position);

-- Reivindica, de forma atômica, a próxima etapa executável do job (ordem estrita por position).
-- SECURITY INVOKER: a RLS do chamador continua valendo. Dois workers concorrentes nunca pegam a mesma etapa.
create or replace function public.claim_next_stage(p_job_id uuid, p_lease_seconds integer default 60)
returns setof public.job_stages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.job_stages;
begin
  select * into v from public.job_stages s
   where s.job_id = p_job_id and s.status not in ('succeeded', 'skipped')
   order by s.position
   limit 1
   for update skip locked;
  if not found then return; end if;

  if v.status = 'running' and v.lease_expires_at is not null and v.lease_expires_at < now() and v.attempts >= v.max_attempts then
    update public.job_stages set status = 'failed', error = 'A etapa foi interrompida e esgotou as tentativas.', lease_expires_at = null, finished_at = now() where id = v.id;
    return;
  end if;

  if (v.status = 'pending' and v.next_attempt_at <= now())
     or (v.status = 'running' and v.lease_expires_at is not null and v.lease_expires_at < now()) then
    update public.job_stages
       set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds)
     where id = v.id
     returning * into v;
    return next v;
  end if;
  return;
end;
$$;
