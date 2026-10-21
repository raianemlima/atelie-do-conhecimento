# ADR 006 — Segmentação estrutural e mapa temático versionado

**Status:** aceito (Fase 4), atrás da flag `NEXT_PUBLIC_PIPELINE_V2`.

**Decisão.**
1. **Segmentação por documento** (`lib/segmentation`): reconhece títulos estruturais (Título/Capítulo/Seção), numerados (`1.`, `1.1`), artigos de lei (parágrafos longos incluídos, com incisos dentro do artigo) e títulos só por corpo de fonte (nível = ranking do tamanho). Sumário com pontilhado é ignorado e registrado. Documento sem títulos vira um trecho único com aviso. Trechos longos ganham janelas com **sobreposição controlada** (núcleos particionam o trecho; a sobreposição respeita um teto).
2. **Mapa temático** (`lib/thematic`): disciplina → tema → subtema, determinístico e sem IA. Seções de fontes diferentes são agrupadas por similaridade de título (média de Jaccard e contenção, com normalização de acentos, plural e stopwords; limiar 0,7). Cada item guarda **cobertura** (trecho, fonte, páginas, caracteres), apelidos, confiança e sinais: `needsReview` (confiança < 0,85, título genérico ou documento sem estrutura) e `singleSource`.
3. **Completude como invariante:** todo trecho com conteúdo aparece em exatamente um item. Itens nunca são apagados: *ignorar* exige motivo e fica registrado; *mesclar* guarda o título antigo como apelido.
4. **Revisão antes da redação** por operações puras e atômicas (renomear, mesclar, mover, mover trecho, dividir, ignorar/reconsiderar). Editar cria uma **nova versão**; a anterior é imutável. Controle otimista (`baseVersion`) evita sobrescrever edição de outra sessão (409). Só uma versão fica **confirmada** por caderno.
5. **Persistência** (migração `0008`, não aplicada): `thematic_maps` com RLS, índice único por job (idempotência) e por versão confirmada, e funções SQL atômicas `save_thematic_map` (lock por caderno) e `confirm_thematic_map`.
6. A etapa `thematic_map` **não usa cache** (`cache: false`): é barata e determinística, e tem o efeito colateral de salvar a versão do caderno, que precisa ocorrer em todo job.

**Limites.** Agrupar só por título erra quando fontes usam nomes muito diferentes para o mesmo tema ou o mesmo nome para temas diferentes; por isso os sinais de revisão e as operações de edição. Refinar o mapa com IA é um passo futuro opcional, sujeito à autorização de chamadas reais.
