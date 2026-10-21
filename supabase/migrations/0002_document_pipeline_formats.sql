alter table public.documents drop constraint if exists documents_format_check;
alter table public.documents add constraint documents_format_check check (format in ('pdf', 'docx', 'md', 'txt'));

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain'
]
where id = 'documents';
