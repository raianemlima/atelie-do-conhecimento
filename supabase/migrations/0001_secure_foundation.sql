create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  subject text not null default '',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  type text not null,
  url text not null default '',
  notes text not null default '',
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  project_id uuid references public.projects(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  file_name text not null,
  format text not null check (format in ('pdf', 'docx', 'md', 'txt')),
  size bigint not null check (size > 0),
  imported_at timestamptz not null default now(),
  sha256 text not null,
  extraction_status text not null check (extraction_status in ('text', 'no-text', 'failed')),
  extracted_text text not null default '',
  page_texts jsonb not null default '[]'::jsonb,
  page_count integer not null default 0,
  storage_path text not null unique
);

create unique index if not exists documents_owner_sha256_idx on public.documents(owner_id, sha256);

alter table public.projects enable row level security;
alter table public.sources enable row level security;
alter table public.chapters enable row level security;
alter table public.documents enable row level security;

drop policy if exists "owner projects" on public.projects;
drop policy if exists "owner sources" on public.sources;
drop policy if exists "owner chapters" on public.chapters;
drop policy if exists "owner documents" on public.documents;
create policy "owner projects" on public.projects for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner sources" on public.sources for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner chapters" on public.chapters for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner documents" on public.documents for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array['application/pdf', 'text/markdown', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown', 'text/plain'];

drop policy if exists "owner document objects select" on storage.objects;
drop policy if exists "owner document objects insert" on storage.objects;
drop policy if exists "owner document objects update" on storage.objects;
drop policy if exists "owner document objects delete" on storage.objects;
create policy "owner document objects select" on storage.objects for select to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "owner document objects insert" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "owner document objects update" on storage.objects for update to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "owner document objects delete" on storage.objects for delete to authenticated using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid()::text));
