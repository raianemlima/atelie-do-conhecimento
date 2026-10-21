# ADR 010 — Cadernos incrementais, versões e estimativa de custo

## Decisão
- **Impressão digital por tema** (`themeFingerprint`): título, caminho, trechos, citações aplicáveis e versão do prompt. Os ids dos temas são estáveis (derivados de nível, título e pai), então um tema que continua igual numa versão maior do caderno mantém o id.
- **Incremental** (`planIncremental`): ao reprocessar, só os temas com impressão diferente (ou sem redação válida) são refeitos; os demais reaproveitam a redação da última versão; temas que saíram do mapa são listados.
- **Versões imutáveis** (`DraftVersionStore`): cada geração cria uma versão ligada à anterior (`baseVersion`); idempotente por job; `diffVersions` compara (adicionados, removidos, alterados, iguais); `restore` cria uma NOVA versão com o conteúdo da antiga, sem apagar histórico.
- **Retomada sem pagar de novo:** o progresso por tema dentro do job é guardado; se a IA falhar no meio e a etapa for repetida, só os temas pendentes são chamados.
- **Estimativa antes de processar** (`estimateDraftCost`): entrada medida no prompt real, saída pelo limite por chamada, preços vindos da configuração (`budget.pricing`; nada fixo no código). Se a estimativa dos temas pendentes passar do teto confirmado, a etapa recusa rodar **antes de qualquer chamada**.

## Consequências
- Só existe o armazenamento em memória. A persistência no Supabase exige uma migração (tabela de versões e de progresso por job), que não foi escrita nem aplicada: depende de banco de desenvolvimento autorizado.
- A estimativa é aproximada (3,5 caracteres por token; saída fixa por tema). A tela de confirmação para o usuário não existe ainda: hoje a "confirmação" é o teto de custo informado na configuração da IA.
- Reaproveitar uma redação antiga não reverifica contra o registro novo; a etapa de verificação (Fase 7) continua rodando sobre o resultado final.
