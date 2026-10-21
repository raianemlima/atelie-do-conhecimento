# ADR 005 — Extração com layout, OCR por página e limpeza determinística

**Status:** aceito (Fase 3), atrás da flag `NEXT_PUBLIC_PIPELINE_V2`.

**Contexto.** O extrator antigo juntava os itens do PDF por coordenada Y e os unia com espaço (colunas intercaladas, tabelas achatadas, rodapés misturados ao corpo) e dependia de o navegador enviar o texto. O limpador antigo apagava qualquer linha repetida em 2+ páginas, inclusive conteúdo legítimo.

**Decisão.**
1. **Extração no servidor, a partir do original** (`lib/extraction`). O texto enviado pelo navegador deixa de ser fonte de verdade. O resultado é estruturado por página em blocos (`header`, `body`, `table`, `footnote`, `footer`), com colunas em ordem de leitura, tabelas preservadas com células, parágrafos reconstruídos e hifenização refeita. Cada bloco aponta a página de origem (rastreabilidade invisível, nunca no texto).
2. **OCR só nas páginas sem camada de texto** (menos de 20 caracteres e com imagens). O OCR é uma *porta* (`OcrProvider`) sem implementação padrão: sem provedor, as páginas são sinalizadas (`ocr_unavailable`, status `partial`/`no-text`) e o aviso chega ao relatório de revisão. Nunca se simula leitura.
3. **Limpeza determinística primeiro** (`lib/cleaning`): cabeçalho/rodapé repetidos são detectados por *zona da página + frequência entre páginas* (não por frequência isolada); marca d'água, links, e-mails, perfis, propaganda, "conforme o material X", marcas do pipeline, fala de IA e numeração são removidos por regras com escopo (trecho, sentença ou linha). Texto sem ruído sai idêntico à fonte.
4. **O que regra não resolve vai para uma lista de ambíguos**, não é apagado: menção a "Prof. X" (pode ser autor doutrinário), marcadores "Aula 3", linhas curtas repetidas, textos únicos de cabeçalho/rodapé. A IA (fases seguintes) ou a usuária decide. Nenhuma chamada de IA foi adicionada.
5. **Um único conjunto de regras** (`rules.ts`) alimenta o limpador e o verificador de ruído (`noise-verifier.ts`), que a Fase 7 estenderá.
6. Handlers v2 (`extraction@2`, `cleaning@2`) entram no pipeline; os v1 ficam exportados só para os testes de caracterização. A chave de cache da extração inclui o id do provedor de OCR e a da limpeza inclui a lista de termos conhecidos.

**Consequências e cuidados.**
- Regras de ruído devem ser **específicas** (frases, não palavras soltas): a primeira versão apagou o art. 134 da CF por causa do verbete "promoção". A suíte de falsos positivos jurídicos e a invariante "a limpeza só remove" existem por isso.
- `pdfjs-dist` precisa de `serverExternalPackages` e de `outputFileTracingIncludes` (worker e fontes) para funcionar em `next start` e em hospedagem serverless; sem isso o worker não é encontrado.
- Falhas de ambiente do pdfjs não são rotuladas como "arquivo corrompido": só as exceções reais de PDF viram `ExtractionError`; as demais seguem para retentativa.
- Saídas de estágio são grandes (~6 KB por página) e ficam em `job_stages` e `stage_cache`.
