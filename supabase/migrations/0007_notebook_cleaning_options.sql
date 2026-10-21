-- FASE 3 (NÃO APLICADA). Aplicar somente em ambiente de desenvolvimento/branch de banco e com autorização.
-- Opções de limpeza por caderno: termos a remover, referências a manter e a política de menções a professores.
-- Requer a 0006 (tabela notebooks). Reversão: 0007_notebook_cleaning_options.down.sql.
alter table public.notebooks
  add column if not exists known_terms text[] not null default '{}' check (cardinality(known_terms) <= 100),
  add column if not exists keep_references text[] not null default '{}' check (cardinality(keep_references) <= 100),
  add column if not exists keep_professors boolean not null default false;
