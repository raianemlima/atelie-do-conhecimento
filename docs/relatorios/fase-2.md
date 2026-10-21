# Relatório da Fase 2 — pipeline em estágios, jobs e persistência

**Branch:** `refactor/pipeline-apostila` (commit local; sem push). Tudo atrás de `NEXT_PUBLIC_PIPELINE_V2` (padrão desligado); o fluxo antigo segue intacto.
**Premissa registrada:** interpretei o seu "continue" como a aprovação para a Fase 2 (a frase exata não foi usada). Se não era isso, é só descartar este commit.
**Auditoria:** continua não fornecida; referência é a linha de base B-1…B-8 (Fase 0).

## Entregas
| Requisito | O que existe |
|---|---|
| Modelo de dados | Migração `0006_pipeline_core.sql` (+ `.down.sql`): `notebooks`, `notebook_sources`, `jobs`, `job_stages`, `stage_cache`, `notebook_versions`, `blocks` (com `source_refs`, a rastreabilidade invisível). RLS por dono em todas, com checagem de que os pais pertencem ao mesmo dono. **Não aplicada em nenhum banco do projeto.** |
| Etapas curtas encadeadas | `POST /api/jobs/[id]/advance` executa uma etapa (timeout 20 s) e grava. Estágios por documento e por caderno, ordem estrita. |
| Retomada após falha | Estado só no banco. Lease de 60 s: processo que morre tem a etapa retomada por outro; ao esgotar tentativas vira `failed`. |
| Retentativa com backoff e limite | 2 s, 4 s, 8 s… teto 60 s; máx. 3 tentativas; erro não retentável falha de imediato; saída inválida/vazia conta como falha. |
| Idempotência | Índice único (caderno + hash das fontes) e hash por estágio; reexecutar job concluído não faz nada. |
| Cache por hash | `stage_cache` por (dono, estágio, hash de estágio+versão+entrada). O mesmo PDF em outro caderno reaproveita tudo (custo e tokens zero). |
| Status real na interface | `components/PipelineProgress.tsx` (só com a flag): barra, etapas agrupadas, nova tentativa, erro acionável. Ao recarregar, lista os jobs ativos do banco e retoma sozinha. |
| Logs estruturados | Por etapa: job, estágio, duração, tokens, custo e status; sem conteúdo dos documentos (testado). |
| Privacidade | A API nunca devolve o `output` das etapas (testado com texto sentinela e com mutação). |

Estágios implementados: **extração** (reaproveita o texto extraído na importação) e **limpeza** (o limpador atual). Os demais estágios entram nas fases seguintes registrando seus handlers; não há chamada de IA ainda.

## Evidência (executada)
- `npm test`: **113 testes passando** (81 anteriores + 32 novos: motor com relógio simulado, API com PostgREST simulado, vazamento de saída).
- **Banco real:** `npm run test:db` aplica 0001–0004 + 0006 num **PostgreSQL 16 local descartável**, valida a reversão (down preserva `documents`), a reaplicação, o isolamento por RLS entre dois usuários (leitura, escrita, vínculos cruzados, claim), ordem estrita/lease/backoff/limite de tentativas de `claim_next_stage`, a idempotência e **concorrência real com duas sessões** (uma única reivindicação).
- **Mutação:** remover `FOR UPDATE SKIP LOCKED` e remover uma checagem de RLS foram detectados; idem limite de tentativas, cache e vazamento de `output` no motor/API.
- **Interface:** Chromium (Playwright) com a API interceptada: fluxo completo com nova tentativa e cache; **recarregar no meio retoma sem clicar**; falha com mensagem acionável no celular (390 px) sem rolagem horizontal. Capturas conferidas visualmente.
- `tsc`, `eslint` e `next build` sem erros.

## NÃO verificado
- Supabase **real**: o Postgres local usa stubs de `auth`/`storage`; o caminho supabase-js ↔ PostgREST (`rpc`, `upsert`, filtros) foi testado só contra o PostgREST simulado, não contra o serviço.
- A interface dentro da página real (a validação visual usou uma página temporária, já removida, porque o app exige sessão Supabase).
- Processamento sem navegador aberto: não existe agendador (ver limites).

## Limites e riscos
1. Sem agendador, o job só avança com a página aberta (retoma ao reabrir). Opções: cron/fila externa chamando o mesmo endpoint; decisão sua (custo/hospedagem).
2. Etapa de limpeza ainda é o limpador atual, com os defeitos medidos na Fase 0; a limpeza determinística completa é a Fase 3.
3. `createJob` não é transacional (supabase-js); em falha, o job é removido.
4. Criação do caderno + vínculo das fontes também não é transacional; em falha, o caderno é removido.
5. Sem limite de taxa nas rotas (pendência desde a Fase 1).

## Decisões que preciso de você
1. Autorizar o push deste commit (os anteriores já estão no remoto).
2. Um Supabase de **desenvolvimento** para aplicar 0006 (e 0005) e validar de verdade.
3. Agendador sim ou não (e qual hospedagem), para o processamento não depender do navegador.
4. O relatório de auditoria, ainda ausente.
5. A frase "aprovado, siga para a fase 3" quando quiser seguir.
