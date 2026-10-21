alter table public.sources add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.chapters add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists sources_project_id_idx on public.sources(project_id);
create index if not exists chapters_project_id_idx on public.chapters(project_id);
