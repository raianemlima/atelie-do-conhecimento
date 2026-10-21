# ADR 001 — Vitest como runner de testes

**Status:** aceito (Fase 0)

**Contexto.** O projeto não tinha testes. A refatoração do pipeline exige testes de caracterização, unitários e de integração em TypeScript, com o alias `@/` e com o `pdfjs-dist`.

**Decisão.** Adicionar `vitest` (devDependency).

**Alternativas.** `node:test` + `--experimental-strip-types` (zero dependência, mas não resolve o alias `@/` nem tem snapshots/mocks ergonômicos); Jest (exige transformação TS/ESM adicional e é mais pesado).

**Consequências.** Licença MIT, mantido ativamente, só em desenvolvimento (não entra no bundle). Em Node 22 o `pdfjs-dist` v6 precisa da build `legacy` e de `Promise.try`; isso é resolvido apenas na configuração de teste (`vitest.config.mts`, `tests/setup.ts`). A Fase 3 (extração no servidor) deverá tratar o mesmo requisito de runtime.
