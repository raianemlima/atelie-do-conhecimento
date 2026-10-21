-- Reversão da 0005: restaura exatamente a política "owner documents" definida na 0004.
drop policy if exists "owner documents select" on public.documents;
drop policy if exists "owner documents update" on public.documents;
drop policy if exists "owner documents delete" on public.documents;
drop policy if exists "owner documents" on public.documents;

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
