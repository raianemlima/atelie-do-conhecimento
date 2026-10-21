-- Reversão da 0008. DESTRUTIVA: apaga todas as versões do mapa temático. Cadernos, jobs e documentos não são afetados.
drop function if exists public.confirm_thematic_map(uuid, integer);
drop function if exists public.save_thematic_map(uuid, uuid, integer, integer, text, text, jsonb, jsonb);
drop table if exists public.thematic_maps;
