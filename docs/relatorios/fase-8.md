# Relatório — Fase 8: cadernos incrementais, versões e custo

## Entregue
`lib/drafting/versions.ts` (impressão digital, plano incremental, diff, restauração, armazenamento em memória), `lib/ai/estimate.ts`, drafting incremental com retomada e pré-checagem de custo, ADR 010.

## Evidências
- `tests/phase8/incremental.test.ts` (10 testes, IA simulada): estimativa (cresce com o texto, determinística, respeita limite de saída); plano (reusa, refaz, aponta removidos); idempotência por job; comparar e restaurar criando nova versão; no pipeline: repetir sem mudança NÃO chama a IA; acrescentar um PDF refaz só os temas afetados (versão 2 baseada na 1); falha no meio e retomada sem repagar; estimativa acima do teto recusa antes de qualquer chamada.
- Mutação: tirar o reaproveitamento do progresso, a recusa por estimativa e a comparação de impressão digital faz testes falharem; restaurado. Suíte completa: 427 testes verdes; `tsc` e `eslint` sem erros.

## Limites
- Sem persistência no Supabase (falta migração; exige banco de desenvolvimento autorizado).
- Sem tela de confirmação de custo nem de comparação/restauração de versões; só a lógica e os testes.
- Estimativa aproximada; preços precisam ser informados na configuração.
- Nenhuma IA real.

## Próximo
Fase 9 (exportação PDF/DOCX/Markdown com sumário, índice remissivo e glossário) — aguardando aprovação.
