# ADR 009 — Verificação automática e relatório de revisão

## Decisão
- `verifyDrafts` (`lib/verification/verify.ts`) roda depois da redação e produz um `ReviewReport` com nota 0–100: limpeza (25), fidelidade (35), cobertura (25), integridade (15). Mínimo: 85 e nenhum achado bloqueante.
- **Limpeza:** nome de arquivo, página, URL, e-mail, perfil social, marcas internas do pipeline, falas da IA, menção a apostila/curso/professor e títulos das fontes. Ruído é bloqueante.
- **Fidelidade:** a frase que contém citação não confirmada pelo registro é **removida** do texto e listada no relatório.
- **Cobertura:** todo nó ativo com conteúdo precisa ter redação; todo trecho com conteúdo precisa estar ligado a um tema redigido. Trechos de nós ignorados explicitamente não contam.
- **Integridade:** bloco truncado (termina em abreviação ou sem pontuação), tema sem texto e parágrafo duplicado.
- O relatório também lista divergências entre fontes, temas de fonte única e avisos de leitura.
- Etapa `verification`: nota abaixo do mínimo ou achado bloqueante faz a etapa **falhar** (o job não é marcado como concluído) com a razão na mensagem.

## Consequências
- O relatório completo só é guardado quando a verificação passa; em caso de falha, a mensagem traz a nota e os primeiros bloqueios. Persistir o relatório de reprovação fica para a Fase 8/10.
- A verificação descobriu uma lacuna da Fase 6: o texto próprio de um tema que também tem subtemas não era redigido. Corrigido (`draftableNodes`).
- Os padrões de ruído são heurísticos e em português; podem exigir ajuste com saídas reais de IA.
