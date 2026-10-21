# ADR 011 — Exportação em PDF, DOCX e Markdown

## Decisão
- **Uma representação intermediária** (`ExportDocument`, `lib/export/types.ts`) construída por `buildExportDocument` a partir do mapa temático, das redações **já verificadas** e do registro de citações. PDF, DOCX e Markdown são escritos a partir dela; nenhum formato lê as redações diretamente.
- **Estrutura:** partes (uma por disciplina), capítulos numerados (1, 2…, contínuos entre disciplinas), seções (1.1…), tabelas, índice remissivo e glossário. Temas ignorados ou sem texto ficam fora, com aviso.
- **Índice remissivo:** só entram citações que o registro de citações confirma (mesma chave canônica), agrupadas por tipo, com as seções onde aparecem. Não há número de página no índice (usa número de seção), para ser igual nos três formatos.
- **Glossário:** vem do campo opcional `glossary` da redação (prompt v2), validado por schema e submetido às mesmas checagens de citação e de ruído. Termo repetido com a mesma definição é unificado; definições diferentes geram aviso.
- **PDF** (`pdf-lib`): paginação própria com título nunca sozinho no fim da página, controle de linhas órfãs e viúvas, tabelas com cabeçalho repetido e linhas que atravessam páginas, rodapé numerado, sumário com números de página corretos e links, e marcadores de navegação. Fontes padrão do PDF (Times/Helvetica); caractere fora do alfabeto é substituído e **contado no aviso**.
- **DOCX** (`jszip`, sem dependência nova): pacote escrito à mão com estilos de título (painel de navegação do Word), sumário com hiperlinks internos e campo `TOC` que o Word atualiza com números de página, tabelas com cabeçalho repetido, rodapé com número de página.
- **Markdown:** sumário com âncoras e tabelas.
- **API:** `GET /api/notebooks/[id]/export?format=pdf|docx|md` e `GET /api/export?notebooks=a,b` ou `?discipline=Nome`. Só exporta apostila cuja **verificação passou**; arquivo é gerado sob demanda e não é guardado.
- Saída determinística: mesma entrada e mesma data geram os mesmos bytes.

## Dependência nova: `pdf-lib` 1.17.1
Necessária para escrever PDF. MIT, JavaScript puro, sem binário nativo e sem leitura de arquivos em tempo de execução (fontes padrão embutidas), o que funciona em funções serverless. Alternativas descartadas: `pdfkit` (lê arquivos de fonte do disco, problemático no empacotamento do Next); gerar PDF à mão (reimplementa fontes, tabelas e marcadores).

## Consequências
- Só caracteres do alfabeto Latin-1/WinAnsi saem fielmente no PDF; o resto vira `?` com aviso. Suporte total a Unicode exigiria embutir uma fonte (próxima melhoria).
- No DOCX os números de página do sumário só aparecem depois de "Atualizar campo" no Word; os links funcionam sem isso.
- A exportação de vários cadernos junta uma parte por caderno; não unifica temas iguais entre cadernos (isso é feito dentro de um caderno, pelo mapa temático).
