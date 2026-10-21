# Relatório da Fase 0 — linha de base e rede de segurança

**Branch:** `refactor/pipeline-apostila` (apenas commits locais; nada enviado).
**Comportamento do app alterado:** nenhum. A flag `NEXT_PUBLIC_PIPELINE_V2` nasce desligada e ainda não é consultada por nenhuma tela.

## Aviso: relatório de auditoria ausente
O prompt veio com o placeholder `[RELATÓRIO DA AUDITORIA AQUI]` vazio. Não há IDs P0–P3 oficiais; as observações abaixo são um **mapeamento próprio do código atual** (rotuladas `B-n`) e devem ser reconciliadas com a auditoria quando ela for fornecida. Nenhum arquivo de produção foi alterado, então não houve risco de divergência.

## Entregas
- Branch e feature flag (`lib/feature-flags.ts`, `.env.example`, ADR 002).
- Vitest como runner (ADR 001). Scripts: `npm test`, `npm run corpus`.
- Golden corpus sintético em `tests/golden/pdfs/` (gerado por `tests/golden/generate_corpus.py`): 01 texto simples; 02a/02b complementares; 03a/03b quase idênticos; 04 ruidoso; 05 citações; 06 digitalizado; 07 corrompido; 08 protegido por senha. Todo o conteúdo é sintético ou texto de lei (domínio público); nomes de curso, professor, autor e julgado são fictícios.
- 27 testes de caracterização (`tests/characterization/`) com snapshots revisados. Mutação deliberada no limpador derrubou 3 testes (a rede detecta regressão).

## Linha de base observada (código atual)
- **B-1** Não existe IA, rota de API, job, teste ou CI. A extração roda 100% no navegador.
- **B-2** Validação de upload (tipo, tamanho, quantidade) só no cliente; o servidor tem limite de 25 MB e lista de MIME no bucket (migrações 0001/0002) e RLS por `owner_id`.
- **B-3** A apostila (`buildIntegratedGuide`, `buildStudyGuide`) está embutida em `DocumentLibraryWorkspace.tsx`, não exportada e não testável; deduplica só por texto exato e imprime "Fonte: arquivo · p. N" e a lista de arquivos no corpo (viola contrato de saída 1 e 4).
- **B-4** Ruído que sobrevive no PDF 04 (snapshot): nome de curso, URL, perfil social, propaganda, "conforme o material", numeração isolada; em `pageTexts` (fonte da apostila) também o professor. A frequência entre páginas remove cabeçalho do `extractedText`, mas também remove conteúdo legítimo repetido.
- **B-5** PDF corrompido e protegido rejeitam com `InvalidPDFException`/`PasswordException` crus; a validação do upload só confere a assinatura `%PDF`.
- **B-6** PDF digitalizado vira `no-text` (sem OCR), como documentado.
- **B-7** Em Node 22 o `pdfjs-dist` v6 exige build `legacy` e `Promise.try`, e avisa `standardFontDataUrl` (relevante para a Fase 3 no servidor).
- **B-8** Pendências fora de escopo: `next`/`react` em `latest` no `package.json`; `tsconfig.tsbuildinfo` versionado.

## Evidência
`npx tsc --noEmit` e `npx eslint .` sem erros; `npm test`: 27 passando; teste de mutação descrito acima.

## Decisões que preciso de você
1. Fornecer o relatório de auditoria (para eu mapear B-n → P0–P3).
2. Autorizar extrair `buildIntegratedGuide`/`buildStudyGuide` para `lib/` sem mudar a saída (necessário para caracterizar a apostila; mudança comportamentalmente neutra, por isso não foi feita na Fase 0).
3. Substituir/complementar o corpus sintético com PDFs reais seus (os "quase idênticos" e o de cursinho reais valem muito).
4. Dizer "aprovado, siga para a fase 1" quando quiser avançar.
