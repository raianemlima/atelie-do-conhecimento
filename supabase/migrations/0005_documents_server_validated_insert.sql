-- FASE 1 (NÃO APLICADA). Aplicar somente em ambiente de desenvolvimento/branch de banco e com autorização.
-- Objetivo: impedir que o navegador grave linhas em public.documents diretamente. Com o fluxo v2,
-- somente a rota /api/documents/finalize (que confere o conteúdo real do arquivo) pode inserir.
--
-- PRÉ-REQUISITO: a rota finalize deve passar a usar um cliente com a chave de serviço
-- (SUPABASE_SERVICE_ROLE_KEY, somente no servidor) e validar que project_id pertence ao usuário,
-- pois o service_role ignora a RLS. Hoje ela usa o cliente da sessão, então aplicar esta migração
-- ANTES dessa troca quebraria o fluxo v2.
--
-- REVERSÃO: 0005_documents_server_validated_insert.down.sql (restaura a política "owner documents" da 0004).

drop policy if exists "owner documents" on public.documents;

-- Mantém a regra da 0004: o dono só enxerga/altera documentos próprios e vinculados a projetos próprios.
create policy "owner documents select" on public.documents
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (project_id is null or project_id in (select id from public.projects where owner_id = (select auth.uid())))
  );

create policy "owner documents update" on public.documents
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (project_id is null or project_id in (select id from public.projects where owner_id = (select auth.uid())))
  )
  with check (
    owner_id = (select auth.uid())
    and (project_id is null or project_id in (select id from public.projects where owner_id = (select auth.uid())))
  );

create policy "owner documents delete" on public.documents
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Sem policy de INSERT para "authenticated": apenas service_role insere.
