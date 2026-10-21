#!/usr/bin/env bash
# Valida migrações e a função de claim em um Postgres DESCARTÁVEL (nunca produção).
# Uso: PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres bash tests/db/verify.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="pipeline_verify_$$"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null
trap '"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null' EXIT
run() { "${PSQL[@]}" -d "$DB" "$@" 2>&1 | grep -v "^NOTICE\|^$" || true; }
apply() { "${PSQL[@]}" -d "$DB" -f "$1" >/dev/null; }

apply tests/db/stubs.sql
for f in 0001_secure_foundation 0002_document_pipeline_formats 0003_project_context 0004_project_ownership_policies; do apply "supabase/migrations/$f.sql"; done
apply supabase/migrations/0006_pipeline_core.sql
echo "OK  migrações 0001-0004 + 0006 aplicadas sem erro"
apply supabase/migrations/0006_pipeline_core.down.sql
test "$("${PSQL[@]}" -d "$DB" -Atc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('notebooks','jobs','job_stages','blocks')")" = "0"
test "$("${PSQL[@]}" -d "$DB" -Atc "select count(*) from public.documents")" = "0"
echo "OK  reversão (down) remove só o pipeline e preserva documents"
apply supabase/migrations/0006_pipeline_core.sql
echo "OK  reaplicação após a reversão"
"${PSQL[@]}" -d "$DB" -f tests/db/assertions.sql | grep -E "^(OK|FALHA)" 

# Concorrência real: duas sessões tentam reivindicar a mesma etapa ao mesmo tempo.
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
set role authenticated;
insert into public.notebooks(id, name) values ('b0000000-0000-4000-8000-0000000000c1','Concorrência');
insert into public.jobs(id, notebook_id, input_hash) values ('c0000000-0000-4000-8000-0000000000c1','b0000000-0000-4000-8000-0000000000c1','hc');
insert into public.job_stages(id, job_id, stage, position) values ('e0000000-0000-4000-8000-0000000000c1','c0000000-0000-4000-8000-0000000000c1','fusion',1);
SQL
SESSION='select set_config($$request.jwt.claim.sub$$,$$aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$$,true); set local role authenticated;'
( "${PSQL[@]}" -d "$DB" -At -c "begin; $SESSION select count(*) from public.claim_next_stage('c0000000-0000-4000-8000-0000000000c1', 60); select pg_sleep(2); commit;" > /tmp/claim1.out ) &
sleep 0.7
"${PSQL[@]}" -d "$DB" -At -c "begin; $SESSION select count(*) from public.claim_next_stage('c0000000-0000-4000-8000-0000000000c1', 60); commit;" > /tmp/claim2.out
wait
c1=$(grep -E '^[0-9]+$' /tmp/claim1.out | head -1); c2=$(grep -E '^[0-9]+$' /tmp/claim2.out | head -1)
att=$("${PSQL[@]}" -d "$DB" -Atc "select attempts from public.job_stages where id='e0000000-0000-4000-8000-0000000000c1'")
if [ "$((c1 + c2))" = "1" ] && [ "$att" = "1" ]; then echo "OK  concorrência real: dois workers, uma única reivindicação (attempts=$att)"; else echo "FALHA concorrência: c1=$c1 c2=$c2 attempts=$att"; exit 1; fi
rm -f /tmp/claim1.out /tmp/claim2.out
echo "TODAS AS VERIFICAÇÕES DE BANCO PASSARAM"
