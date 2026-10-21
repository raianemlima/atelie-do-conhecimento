-- Reversão da 0007. Apaga apenas as três colunas de opções; cadernos e jobs permanecem.
alter table public.notebooks
  drop column if exists known_terms,
  drop column if exists keep_references,
  drop column if exists keep_professors;
