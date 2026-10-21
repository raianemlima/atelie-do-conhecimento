# Relatório da Fase 4 — segmentação estrutural e mapa temático

**Branch:** `refactor/pipeline-apostila` (commit local; **sem push**, por causa do limite de deploys do Vercel). Atrás de `NEXT_PUBLIC_PIPELINE_V2`; fluxo antigo intacto.
**Premissa registrada:** interpretei "prossiga com as demais sugestões" como aprovação da Fase 4.

## Entregas
| Requisito | O que existe |
|---|---|
| Segmentação respeitando títulos, capítulos, artigos e seções | `lib/segmentation`: níveis estruturais, numerados, artigos (com incisos), títulos por tamanho de fonte; sumário ignorado e registrado. |
| Sobreposição controlada | Janelas por trecho longo: núcleos particionam tudo, sobreposição limitada, parágrafo gigante não é cortado. |
| Mapa disciplina → tema → subtema com fontes e trechos | `lib/thematic`: agrupamento determinístico por título entre fontes; cobertura por trecho/fonte/página; apelidos, confiança, `fonte única`, `revisar`. |
| Persistido | Migração `0008` + `SupabaseMapStore`; versões imutáveis; uma confirmada por caderno. |
| Revisável antes da redação | API (`GET /map`, `POST /map/edit`, `POST /map/confirm`) e painel "Mapa temático": renomear, mesclar, ignorar com motivo, reconsiderar, confirmar. |
| Completude | Invariante validada após cada operação; nada é apagado. |

## Defeitos achados e corrigidos DURANTE a fase
1. **Extrator de layout:** artigos e incisos seguidos viravam um único parágrafo (a mediana de espaçamento era contaminada por parágrafos de uma linha). Passou a usar o quartil inferior e a quebrar por início de item jurídico (`Art.`, `§`, incisos, alíneas).
2. **Artigo longo não era reconhecido** (limite de 200 caracteres pensado para títulos).
3. **Tema legítimo tratado como "título do documento"** quando tinha dois subtemas: regra refinada (só é envoltório se quase sem conteúdo próprio).
4. **Títulos genéricos** não eram detectados por comparar formas não normalizadas ("noções").
5. **Renomear perdia o título antigo** (ordem das chamadas do apelido).
6. **Fixture com hifenização falsa** no PDF ruidoso (palavra partida entre blocos separados por linha em branco); corrigido para refletir PDF real.
7. **Regressão minha:** ao ligar o `SupabaseMapStore` nas rotas, os testes de rota quebraram (o simulador não conhecia as funções RPC). Ensinei o simulador com a mesma semântica do SQL.

## Evidência (executada)
- **368 testes passando** (`tsc`, `eslint` e `next build` sem erros); +52 testes de segmentação/mapa/operações/rotas/ponta a ponta.
- **Banco real (Postgres 16 descartável):** 0008 aplica, reverte (sem afetar cadernos) e reaplica; versão automática idempotente por job; edição cria nova versão e a antiga fica intacta; edição desatualizada recusada; uma única versão confirmada; isolamento por RLS; **concorrência real**: duas edições simultâneas receberam versões distintas.
- **Mutações detectadas (12):** artigo longo descartado, sumário não ignorado, sobreposição sem controle, similaridade só por contenção, fusão de seções do mesmo documento, título-tema como envoltório, validação que aceita duplicata, mesclar tema sem levar subtemas, mesclar perdendo cobertura, mapa duplicado por job; no banco: sem lock de versão e sem índice de única confirmada.
- **Interface (Chromium, mapa real do corpus):** edições, conflito 409 com recarga, ignorar exigindo motivo, confirmar; o cliente nunca envia data; celular sem rolagem horizontal.

## NÃO verificado
- **Fontes reais:** tudo foi ajustado em PDFs sintéticos. Apostilas reais têm nomes de tema, numeração e sumários mais irregulares.
- Supabase real (o caminho supabase-js ↔ PostgREST das funções RPC foi testado só contra simulação; o SQL foi validado em Postgres de verdade).
- A tela dentro do app real (validada em página temporária, já removida).
- Migrações 0006, 0007 e 0008 **não foram aplicadas** em nenhum banco do projeto.

## Limites e riscos
1. Agrupar por título é heurístico: nomes muito diferentes para o mesmo tema não se fundem; mesmo nome para temas diferentes pode fundir (sinalizado como `revisar` quando a confiança é baixa).
2. Documento sem títulos reconhecíveis vira um único tema; exige revisão (ou IA, em fase futura).
3. A disciplina é informada ao criar o caderno (padrão: o nome do caderno).
4. Dividir e mover trechos entre itens existem na API, mas a tela só oferece renomear, mesclar, ignorar e confirmar.

## Decisões que preciso de você
1. Resolver o **limite de deploys do Vercel** (há 3 projetos ligados ao mesmo repositório) antes de eu fazer push.
2. PDFs reais, para eu ajustar títulos, sumários e agrupamento de verdade.
3. Supabase de desenvolvimento para aplicar 0006–0008 e validar o fluxo real.
4. Quer refinar o mapa com IA (exige sua autorização para chamadas reais, com teto de custo)?
5. "continue" ou "aprovado, siga para a fase 5" (registro de citações jurídicas).
