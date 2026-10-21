# ADR 007 — Registro de citações jurídicas

## Contexto
Os cadernos juntam várias apostilas. A mesma norma ou precedente aparece escrito de formas diferentes ("art. 5º, LXXIV, da CF/88", "artigo 5, inciso 74, da Constituição Federal"), às vezes com enunciados ou dados divergentes. O texto final não pode inventar citações.

## Decisão
- Etapa `citation_registry` (escopo do caderno, determinística, sem IA), depois do mapa temático.
- Cada citação recebe uma **chave canônica** (`law|CF/1988|art:5|inc:74`, `sumula:STJ:421`, `case|REsp|1234567`…). Equivalências de diplomas ficam em `lib/citations/diplomas.ts` (CDC = Lei 8.078/1990).
- Artigo sem diploma identificado **não** é unificado com diploma conhecido (fica marcado como ambíguo).
- Enunciados e metadados de processos são guardados literalmente; dois enunciados só são compatíveis se um contém o outro (após normalização). Do contrário, registra-se uma **divergência** — nunca se escolhe um lado em silêncio.
- `verifyCitations` confere se toda citação de um texto gerado existe no registro (base da verificação anti-invenção das fases seguintes).
- `GET /api/notebooks/[id]/citations` devolve o registro do último job concluído.

## Consequências
- Heurísticas por expressão regular: precisão validada apenas em corpus sintético; citações em formatos raros podem escapar (falso negativo) — por isso a etapa avisa documentos sem nenhuma citação reconhecida.
- Sem IA, sem custo. Refinamento por IA exigiria autorização e teto de custo.
