drop policy if exists "owner sources" on public.sources;
drop policy if exists "owner chapters" on public.chapters;
drop policy if exists "owner documents" on public.documents;

create policy "owner sources" on public.sources
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  );

create policy "owner chapters" on public.chapters
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  );

create policy "owner documents" on public.documents
  for all to authenticated
  using (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  )
  with check (
    owner_id = auth.uid()
    and (project_id is null or project_id in (
      select id from public.projects where owner_id = auth.uid()
    ))
  );
