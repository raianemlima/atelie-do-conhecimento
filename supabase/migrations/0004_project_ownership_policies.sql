drop policy if exists "owner sources" on public.sources;
drop policy if exists "owner chapters" on public.chapters;
drop policy if exists "owner documents" on public.documents;

create policy "owner sources" on public.sources
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = sources.project_id and projects.owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = sources.project_id and projects.owner_id = auth.uid()
    ))
  );

create policy "owner chapters" on public.chapters
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = chapters.project_id and projects.owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = chapters.project_id and projects.owner_id = auth.uid()
    ))
  );

create policy "owner documents" on public.documents
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = documents.project_id and projects.owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or exists (
      select 1 from public.projects
      where projects.id = documents.project_id and projects.owner_id = auth.uid()
    ))
  );
