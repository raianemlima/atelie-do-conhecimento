# ADR 008 — Fusão e redação por tema com IA

## Contexto
A Fase 6 gera o texto didático de cada tema a partir de todos os trechos de todas as fontes. O texto não pode inventar citações nem mencionar a origem, e chamadas de IA têm custo.

## Decisão
- `AiProvider` (`lib/ai/types.ts`) é só um contrato. **Não há implementação real**: chamadas reais exigem autorização e teto de custo. Os testes usam provedor simulado.
- Fusão (`lib/drafting/inputs.ts`): por tema-folha do mapa, reúne os trechos de todas as fontes e só as citações do registro ligadas a esses trechos.
- Prompt versionado (`DRAFT_PROMPT_VERSION`), uma chamada **por tema**, resposta em JSON validada à mão por schema (`schema.ts`; sem dependência nova).
- Aceitação independente do modelo (`checkDraft`): citações (na lista `citationsUsed` e no texto) só do conjunto fornecido; nenhuma menção aos títulos das fontes. Resposta cortada (`max_tokens`), fora do schema ou recusada é tentada de novo (2 tentativas) com a razão; esgotadas, o tema falha.
- Etapa `drafting` (notebook): sem `deps.ai` é pulada. Com `deps.ai`, para antes do próximo tema se o custo acumulado atingiu o teto. O pipeline padrão (`DEFAULT_HANDLERS`) **não** inclui a etapa; `AI_HANDLERS` inclui, para ser ligado depois de autorizado.

## Consequências
- O teto é conferido antes de cada tema: uma única chamada pode ultrapassá-lo em até o custo de um tema (limitado por `maxTokensPerCall`).
- Se um tema falha, os temas já redigidos naquela execução não são persistidos (o cache por etapa só guarda a etapa concluída); a persistência incremental por tema fica para a Fase 8.
- Qualidade real da redação só pode ser avaliada com IA real, ainda não autorizada.
