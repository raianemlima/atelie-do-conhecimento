# ADR 004 — Pipeline em etapas curtas, persistidas e retomáveis

**Status:** aceito (Fase 2), atrás da flag `NEXT_PUBLIC_PIPELINE_V2`.

**Contexto.** A hospedagem serverless limita o tempo de cada requisição; um processamento longo numa única chamada seria cortado. O estado do processamento não pode viver em memória nem no navegador.

**Decisão.**
- Cada job é um plano de etapas (`job_stages`), uma linha por estágio e por documento (estágios por caderno têm `subject_id` nulo), em ordem estrita (`position`).
- `POST /api/jobs/[id]/advance` executa **uma** etapa curta (timeout de 20 s) e grava o resultado. Quem chamar de novo continua do estado gravado. Hoje o navegador encadeia as chamadas; um agendador pode chamar o mesmo endpoint sem mudar o motor.
- A reivindicação de etapa é atômica no banco (`claim_next_stage`: `FOR UPDATE SKIP LOCKED`, lease de 60 s, contador de tentativas). Processo que morre deixa a lease expirar e a etapa é retomada; ao esgotar as tentativas ela é marcada como `failed`.
- Falha retentável: backoff exponencial (2 s, 4 s, 8 s… teto de 60 s), no máximo 3 tentativas. Falha não retentável (ex.: documento inexistente, resposta fora do schema) falha de imediato, com mensagem clara. Saída inválida nunca conta como sucesso.
- Cache por hash: `stage_cache(owner, estágio, hash)`, com o hash derivado de estágio + versão do handler + entrada. O mesmo PDF nunca é processado duas vezes, nem em cadernos diferentes. Mudar a versão do handler invalida o cache.
- Idempotência: um índice único impede dois jobs ativos/concluídos com o mesmo caderno e o mesmo hash de fontes.
- A API nunca devolve o `output` das etapas (pode conter texto dos documentos); só status, tentativas, erro, cache, duração e custo.

**Alternativas.** Fila externa (Inngest, Trigger.dev, QStash): resolveria o processamento sem navegador aberto, mas adiciona serviço e dependência; fica como evolução, pois o motor já é independente de quem o aciona. Postgres `pg_cron`: descartado por depender do plano de hospedagem.

**Limites conhecidos.** Enquanto não houver agendador, o processamento só avança com um navegador aberto (ao reabrir a página, retoma sozinho). O supabase-js não tem transação: se a inserção das etapas falhar, o job é removido.
