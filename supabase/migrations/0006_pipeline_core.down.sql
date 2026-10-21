-- Reversão da 0006. DESTRUTIVA: apaga cadernos, jobs, estágios, cache, versões e blocos.
-- Os documentos (public.documents) e os originais no Storage NÃO são afetados.
drop function if exists public.claim_next_stage(uuid, integer);
drop table if exists public.blocks;
drop table if exists public.notebook_versions;
drop table if exists public.stage_cache;
drop table if exists public.job_stages;
drop table if exists public.jobs;
drop table if exists public.notebook_sources;
drop table if exists public.notebooks;
