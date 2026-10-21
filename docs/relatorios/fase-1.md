# Relatório da Fase 1 — segurança e funcionamento básico (P0)

**Branch:** `refactor/pipeline-apostila`. Tudo novo fica atrás de `NEXT_PUBLIC_PIPELINE_V2` (padrão desligado); o fluxo antigo segue intacto.
**Auditoria:** continua não fornecida; referência é a linha de base B-1…B-8 do relatório da Fase 0.

## O que foi feito
| Item | Entrega |
|---|---|
| IA e chaves no servidor (B-1) | Ainda **não existe chamada de IA** no código. Criei `lib/server/env.ts` (validação na inicialização, recusa segredos com prefixo `NEXT_PUBLIC_`, nunca imprime valores) e documentei `SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY` como somente servidor. |
| Autenticação/autorização | `proxy.ts` agora responde **401 JSON** em `/api/*` sem sessão (páginas continuam redirecionando a `/login`). Cada rota ainda reconfere a sessão (`requireUser`). |
| Isolamento entre usuários (B-2) | RLS e políticas de storage já existiam. As rotas leem pelo cliente da sessão (RLS), derivam o caminho do `user.id` autenticado e tratam documento alheio como 404. |
| URLs assinadas | Envio e download por URL assinada (download de 60 s). |
| Validação de upload no servidor (B-2, B-5) | Nome (travessia, controle, tamanho), extensão, tamanho, lote, duplicidade, conteúdo real, SHA-256; PDF truncado e arquivo renomeado são rejeitados com mensagem acionável. |
| Fluxo básico | Nenhum bloqueio concreto identificável sem a auditoria; o app compila, sobe e redireciona corretamente. |

Correção da Fase 0 feita aqui: a flag lia `process.env` por objeto, o que **não é embutido no navegador** pelo Next; agora usa acesso literal.

## Evidência (executada)
- `npm test`: **81 testes passando** (27 da Fase 0 + 54 novos: regras de upload com o corpus e arquivos falsificados, ambiente, rotas com Supabase simulado, fronteira servidor/cliente). `tsc` e `eslint` sem erros.
- Build de produção com a flag ligada e `next start`: `POST /api/documents/prepare` e `GET /api/documents/<id>/download` sem sessão → **401 JSON**; `/documentos` sem sessão → 307 `/login`.
- Valores-sentinela em `SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY`: **ausentes** de `.next/static` e de `.next/server`.

## NÃO verificado
- O fluxo v2 ponta a ponta contra um Supabase real (não há credenciais aqui): upload por URL assinada, `finalize` e download assinado foram testados só com Supabase simulado.
- Verificação visual da interface.

## Migração (escrita, NÃO aplicada)
`0005_documents_server_validated_insert.sql` (+ `.down.sql`): remove o INSERT direto do navegador em `documents`, preservando a regra de posse de projeto da 0004. **Pré-requisito:** `finalize` passar a usar a chave de serviço e validar `project_id`. Aplicar antes disso quebra o fluxo v2.

## Pendências registradas
1. Texto extraído ainda vem do cliente (Fase 3 move a extração ao servidor).
2. `next`/`react` em `latest`; `tsconfig.tsbuildinfo` versionado (Fase 0, B-8).
3. Rate limiting nas rotas (não implementado).
4. A rota de prepare consulta duplicatas por hash, mas a unicidade real é garantida pelo índice `documents_owner_sha256_idx`.

## Decisões que preciso de você
1. Relatório de auditoria (para reconciliar B-n com P0–P3 e confirmar se há "bloqueios do fluxo básico" que eu não enxerguei).
2. Autorizar aplicar a 0005 em um banco de **desenvolvimento** (e fornecer o ambiente), junto com a troca para a chave de serviço, ou manter adiada.
3. Credenciais de um Supabase de desenvolvimento para eu validar o fluxo v2 de verdade.
4. "aprovado, siga para a fase 2".
