# Relatório da Fase 3 — extração e limpeza

**Branch:** `refactor/pipeline-apostila` (commit local; sem push). Atrás de `NEXT_PUBLIC_PIPELINE_V2`; fluxo antigo intacto.
**Premissa registrada:** interpretei o seu "continue" como a aprovação da Fase 3.
**Auditoria:** continua não fornecida; referência é a linha de base B-1…B-8 (Fase 0). A Fase 3 trata B-4 (ruído) e B-6 (digitalizados).

## Entregas
| Requisito | O que existe |
|---|---|
| Ordem de leitura, colunas, tabelas, notas de rodapé | `lib/extraction/layout.ts`: duas colunas com título em largura total, tabelas com células (`A \| B`), notas de rodapé separadas, zonas de cabeçalho/rodapé, parágrafos reconstruídos, hifenização refeita. |
| Extração no servidor | Estágio `extraction@2` lê o **arquivo original** do armazenamento (o texto do navegador deixa de valer). PDF, DOCX (parágrafos e tabelas), Markdown e TXT. |
| Páginas sem texto e OCR só nelas | Detecta página sem camada de texto (< 20 caracteres e com imagem); distingue página em branco. Porta `OcrProvider` (**sem implementação**): sem provedor, aviso explícito e status `partial`/`no-text`; com provedor, só as páginas sem texto são enviadas. |
| Limpeza determinística primeiro | `lib/cleaning`: cabeçalho/rodapé por zona + frequência, marca d'água, links, e-mails, perfis, propaganda, "conforme o material X", marcas do pipeline, fala de IA, numeração, hifenização, costura de parágrafo entre páginas. |
| IA só para o que regra não resolve | Lista de **ambíguos** (não removidos) e `learnedTerms`; nenhuma chamada de IA. |
| Verificador de ruído | `findNoise`/`noiseCategories` compartilham as regras do limpador; o PDF ruidoso passa e o texto bruto reprova. |

## Defeitos encontrados e corrigidos DURANTE a fase (importa para a confiança)
1. **Regra de propaganda apagou o art. 134 da CF inteiro** ("promoção dos direitos humanos") e uma frase legítima do PDF ruidoso. Regras passaram a ser frases específicas; há suíte de falsos positivos jurídicos (9 casos) e a invariante "a limpeza só remove palavras".
2. **Perda do `;` final** do art. 5º, LXXIV: a pontuação só é normalizada quando algo foi removido; sem remoção, o texto sai idêntico.
3. **O pdfjs não funcionava no servidor Next de produção** (worker não encontrado), apesar de passar nos testes unitários. Corrigido com `serverExternalPackages` e verificado em build + `next start` reais.
4. **O worker não era rastreado para deploy serverless** (verificado nos arquivos `.nft.json`). Corrigido com `outputFileTracingIncludes`; o rastreamento agora lista o worker e as fontes.
5. Uma falha de ambiente estava sendo rotulada "PDF corrompido, verifique o arquivo". Agora só exceções reais de PDF viram erro de arquivo.
6. "Prof. X" removido por regra poderia apagar autor doutrinário citado: virou item de revisão.
7. Meu teste de cache reaproveitava o mesmo job (idempotência) e passava sem testar cache; corrigido e provado por mutação.

## Evidência (executada)
- **193 testes passando** (113 anteriores + 80 novos), `tsc`, `eslint` e `next build` sem erros.
- **PDF ruidoso:** texto final exato, sem ruído, `findNoise` vazio; bruto reprova nas categorias esperadas.
- **Citações verbatim** (art. 134, art. 5º LXXIV com `;`, súmula, julgado, autor com `p. 123`): saída idêntica à fonte.
- **Mutações** (9) detectadas: regra de propaganda genérica, pontuação sem remoção, colunas desligadas, OCR em todas as páginas, sem remoção de cabeçalho repetido, sentenças com link mantidas, provedor fora da chave de cache, cache desligado.
- **Servidor real:** build de produção + `next start`: PDF ruidoso limpo, misto com `ocr_unavailable`, corrompido e protegido por senha com mensagem acionável, sem erro no log.
- **Desempenho:** 300 páginas de texto denso: extração ≈ 3,2 s, limpeza ≈ 0,3 s (timeout de etapa: 20 s).

## NÃO verificado
- **PDFs reais.** Todo o ajuste foi feito no corpus sintético. Layouts reais (cursinhos, escaneados com texto ruim, tabelas complexas, colunas irregulares, rodapés com ícones) vão revelar casos novos. **O maior ganho agora é você me fornecer 3 a 5 PDFs reais** (inclusive o da captura de tela original).
- Deploy serverless de fato (só o rastreamento foi verificado).
- Banco: nenhuma mudança de SQL nesta fase; `npm run test:db` não foi reexecutado.
- Fontes não embutidas em PDFs reais de produção podem alterar larguras e, com isso, a detecção de células.

## Limites e riscos
1. **OCR não existe.** Opções para decidir: `tesseract.js` (sem serviço externo, mas pesado e lento em serverless; baixa modelos de idioma), serviço de OCR em nuvem (rápido e preciso, mas envia o conteúdo a terceiro: **fere a política de proveniência/privacidade se você não autorizar**), ou OCR em worker próprio. Precisa da sua decisão antes de eu implementar.
2. Heurísticas de coluna/tabela/nota de rodapé são heurísticas: tabelas com células longas podem ser lidas como colunas, e rodapé em fonte do mesmo tamanho do corpo não vira nota.
3. Cabeçalho/rodapé em documento de **1 página** só sai se tiver ruído reconhecível; um cabeçalho de cursinho sem marca d'água, e-mail, link ou termo conhecido permanece.
4. Nomes de curso/professor só são removidos do corpo se estiverem na lista de termos conhecidos (`knownTerms`); ainda **não há tela** para a usuária informar essa lista por caderno.
5. A saída das etapas (~6 KB/página) é gravada em `job_stages` e também em `stage_cache`.

## Decisões que preciso de você
1. PDFs reais para o corpus (ideal: um por origem).
2. OCR: qual caminho (e se aceita enviar páginas digitalizadas a um serviço externo).
3. Tela/campo para a lista de termos conhecidos do caderno (marca, curso, professor)?
4. Autorizar o push deste commit; ainda faltam o Supabase de desenvolvimento e o relatório de auditoria.
5. A frase "aprovado, siga para a fase 4" (ou "continue") quando quiser seguir.

## Adendo (pedido posterior): professores e opções de limpeza
- **Padrão novo:** o texto final não referencia professores (atribuições removidas, frase preservada e recapitalizada; cabeçalho/rodapé com professor sai por inteiro). Autor doutrinário sem "Prof." é preservado.
- **Opção para manter/referenciar:** por caderno, na tela "Montar caderno > Opções de limpeza": *termos a remover*, *referências a manter* (nome, trecho ou link, protegido de qualquer remoção) e *manter menções a professores*.
- **Interpretação que adotei:** "deixar a opção caso eu queira referenciar algum texto" = poder manter professores em geral ou proteger referências específicas. Se você quis dizer outra coisa (por exemplo, citar a fonte de cada trecho no texto), me diga.
- **Evidência:** 225 testes; 5 mutações detectadas (opções ignoradas no advance, no hash do job, na chave de cache, política de professores, proteção de referências); migração 0007 validada em Postgres descartável (padrão seguro, limite de 100 itens, reversão preserva cadernos); tela verificada no Chromium (corpo da requisição, celular sem rolagem horizontal).
- **Limite:** a migração 0007 não foi aplicada; com opções não padrão e sem ela, o servidor devolve erro de coluna inexistente.
