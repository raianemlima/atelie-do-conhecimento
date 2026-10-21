# ADR 002 — Feature flag `NEXT_PUBLIC_PIPELINE_V2`

**Status:** aceito (Fase 0)

**Decisão.** O novo pipeline em estágios só é acionado quando `NEXT_PUBLIC_PIPELINE_V2=true` (ver `lib/feature-flags.ts`). O padrão é desligado; o fluxo atual continua intacto até a aprovação explícita do novo.

**Consequências.** Toda entrada nova do pipeline v2 (rotas, telas, jobs) deve consultar `isPipelineV2Enabled()`. A flag e o fluxo antigo só serão removidos na Fase 10, com aprovação.
