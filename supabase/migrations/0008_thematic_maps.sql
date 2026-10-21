-- FASE 4 (NÃO APLICADA). Aplicar somente em ambiente de desenvolvimento/branch de banco e com autorização.
-- Versões do mapa temático por caderno. Versões são imutáveis: editar cria uma nova; nada é sobrescrito.
-- Requer a 0006 (notebooks, jobs). Reversão: 0008_thematic_maps.down.sql.

create table if not exists public.thematic_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  source_job_id uuid references public.jobs(id) on delete set null,
  version integer not null check (version > 0),
  base_version integer check (base_version > 0),
  origin text not null check (origin in ('auto', 'edited')),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_at timestamptz,
  discipline text not null default '',
  map jsonb not null,
  change_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (notebook_id, version)
);

-- Um mapa automático por job (idempotência) e no máximo uma versão confirmada por caderno.
create unique index if not exists thematic_maps_job_idx on public.thematic_maps(notebook_id, source_job_id) where source_job_id is not null;
create unique index if not exists thematic_maps_one_confirmed_idx on public.thematic_maps(notebook_id) where status = 'confirmed';
create index if not exists thematic_maps_notebook_idx on public.thematic_maps(notebook_id, version desc);

alter table public.thematic_maps enable row level security;

create policy "owner thematic_maps" on public.thematic_maps for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and notebook_id in (select id from public.notebooks where owner_id = (select auth.uid())));

-- Cria a próxima versão de forma atômica (o lock por caderno serializa a numeração).
-- Automática: idempotente por p_source_job_id. Editada: exige p_expected_latest igual à versão mais recente
-- (controle otimista de concorrência) ou falha com 'stale_map'.
create or replace function public.save_thematic_map(
  p_notebook_id uuid, p_source_job_id uuid, p_base_version integer, p_expected_latest integer,
  p_origin text, p_discipline text, p_map jsonb, p_change_log jsonb
) returns public.thematic_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_latest integer;
  v_row public.thematic_maps;
begin
  perform pg_advisory_xact_lock(hashtext(p_notebook_id::text));
  if p_source_job_id is not null then
    select * into v_row from public.thematic_maps where notebook_id = p_notebook_id and source_job_id = p_source_job_id;
    if found then return v_row; end if;
  end if;
  select coalesce(max(version), 0) into v_latest from public.thematic_maps where notebook_id = p_notebook_id;
  if p_expected_latest is not null and p_expected_latest <> v_latest then
    raise exception 'stale_map' using errcode = 'P0001';
  end if;
  insert into public.thematic_maps(notebook_id, source_job_id, version, base_version, origin, discipline, map, change_log)
  values (p_notebook_id, p_source_job_id, v_latest + 1, p_base_version, p_origin, coalesce(p_discipline, ''), p_map, coalesce(p_change_log, '[]'::jsonb))
  returning * into v_row;
  return v_row;
end;
$$;

-- Confirma uma versão e desconfirma a anterior, na mesma transação.
create or replace function public.confirm_thematic_map(p_notebook_id uuid, p_version integer)
returns public.thematic_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.thematic_maps;
begin
  perform pg_advisory_xact_lock(hashtext(p_notebook_id::text));
  if not exists (select 1 from public.thematic_maps where notebook_id = p_notebook_id and version = p_version) then
    raise exception 'map_not_found' using errcode = 'P0002';
  end if;
  update public.thematic_maps set status = 'draft', confirmed_at = null where notebook_id = p_notebook_id and status = 'confirmed';
  update public.thematic_maps set status = 'confirmed', confirmed_at = now() where notebook_id = p_notebook_id and version = p_version returning * into v_row;
  return v_row;
end;
$$;
