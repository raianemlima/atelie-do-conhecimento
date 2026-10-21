# Relatório — Fase 6: fusão e redação didática

## Entregue
`lib/ai/types.ts`, `lib/drafting/{types,prompt,schema,draft,inputs}.ts`, etapa `draftingHandler` e `AI_HANDLERS`, ADR 008.

## Evidências
- `tests/phase6/drafting.test.ts` (14 testes, IA simulada): schema (6 rejeições), citação inventada recusada com nova tentativa, chave fora da lista, menção à origem, resposta cortada nunca aceita, etapa pulada sem provedor, uma chamada por tema, custo/tokens agregados, parada por teto de custo.
- Mutação: desligar a checagem de citações no texto e desligar o teto de custo fazem testes falharem; restaurado. Suíte completa: 391 testes verdes; `tsc` e `eslint` sem erros.

## Limites
- **Nenhuma chamada real de IA foi feita**; não há provedor real. A qualidade do texto gerado não foi avaliada.
- Etapa não ligada ao fluxo padrão nem à interface; depende de autorização, provedor e teto de custo.
- Fusão simples (todos os trechos do tema no prompt); temas muito grandes podem precisar de divisão.

## Próximo
Fase 7 (verificação e relatório de revisão) pode ser feita com IA simulada. Aguardando "aprovado, siga para a fase 7". Para IA real: escolher provedor, chave no servidor e teto de custo.
