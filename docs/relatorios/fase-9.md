# Relatório — Fase 9: exportação

## Entregue
`lib/export/{types,build,markdown,docx,pdf,index,from-stages}.ts`, `lib/server/export.ts`, rotas `GET /api/notebooks/[id]/export` e `GET /api/export`, campo `glossary` na redação (prompt v2), ADR 011. Dependência nova: `pdf-lib` (justificativa no ADR).

## Evidências
- 35 testes novos (`tests/phase9`, mais 4 no `tests/phase6`). Suíte completa: 457 verdes; `tsc`, `eslint` e `next build` sem erros.
- **Os arquivos exportados são abertos e conferidos:** o PDF é lido com o pdfjs (texto por página, páginas do sumário batem com a página real de cada título, marcadores, índice e glossário); o DOCX é descompactado (partes obrigatórias, XML bem formado, estilos de título, âncoras do sumário existem, tabelas, escape de `& < > "` e de caracteres de controle); o Markdown tem âncoras válidas. Os três passam no verificador de ruído.
- Paginação: parágrafo de 260 repetições, célula de tabela gigante (atravessa várias páginas, com o cabeçalho repetido em todas) e nenhum texto perdido; título nunca sozinho no fim da página.
- Ponta a ponta com IA simulada: pipeline → verificação → exportação nos três formatos. Apostila reprovada na verificação ou sem IA **não** é exportável. Rotas: tipo, nome do arquivo, `no-store`, 400/401/404.
- Mutação (defeito injetado e testes falhando): página do sumário errada, índice com citação não confirmada, título sozinho no fim da página, âncora do sumário quebrada, cabeçalho de tabela não repetido, `&` sem escape, texto perdido na paginação. Código restaurado.
- **Conferência visual:** PDF renderizado com `pdftoppm` e DOCX convertido pelo LibreOffice, em uma e duas disciplinas. Dois defeitos achados e corrigidos (barra da capa sobre o título; termo do glossário sem destaque).

## Limites
- Só fontes padrão no PDF: caracteres fora do Latin-1 viram `?` (com aviso).
- Índice remissivo por número de seção, não por página. Sumário do DOCX sem número de página até o Word atualizar o campo.
- Sem tela de exportação: só as rotas. Sem IA real: o conteúdo exportado nos testes é simulado, então a aparência com texto real não foi avaliada.
- A extração de citações não reconhece "inciso LXXIV do art. 5º" (ordem invertida); nesse caso a citação não entra no índice. Melhoria do extrator, fora desta fase.
- Exportar vários cadernos não unifica temas repetidos entre eles.

## Próximo
Fase 10 (observabilidade, custo, mensagens de erro e remoção do fluxo antigo/flag, esta somente após aprovação) — aguardando aprovação.
