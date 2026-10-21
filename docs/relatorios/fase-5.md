# Relatório — Fase 5: registro de citações jurídicas

## Entregue
- `lib/citations/{types,diplomas,extract,registry,verify,for-theme}.ts`, etapa `citationRegistryHandler`, rota `GET /api/notebooks/[id]/citations`, ADR 007.
- Corpus: `18a-citacoes-a.pdf` e `18b-citacoes-b.pdf` (mesmas normas em formatos diferentes + divergências plantadas).

## Evidências
- `tests/phase5/citations.test.ts` (9 testes): equivalência de formatos, unificação entre apostilas (13 citações, 6 multi-fonte), divergências (Súmula 421/STJ: enunciado; REsp 1.234.567: relator, data, ementa), determinismo, vínculo com o mapa, verificação de citação inventada.
- Mutação: desligar a detecção de divergência e quebrar a equivalência do CDC fazem os testes falharem; código restaurado. Suíte completa: 377 testes verdes; `tsc` e `eslint` sem erros.
- Testes de plano/progresso das fases 2–4 atualizados (nova etapa: 8 etapas em vez de 7).

## Limites
- Heurísticas validadas só em corpus sintético; faltam PDFs reais.
- Painel de interface do registro (`CitationRegistryPanel`) **não** foi feito nesta fase; a API já entrega os dados.
- Migrações 0005–0008 seguem sem aplicação em banco real.

## Próximo
Aguardando "aprovado, siga para a fase 6".
