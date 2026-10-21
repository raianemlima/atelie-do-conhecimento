# ADR 003 — Upload com validação no servidor e URLs assinadas

**Status:** aceito (Fase 1), atrás da flag `NEXT_PUBLIC_PIPELINE_V2`.

**Contexto.** O navegador enviava o arquivo direto ao Storage e gravava a linha em `documents`; toda validação (tipo, tamanho, assinatura) rodava só no cliente e era contornável. Rotas de servidor em hospedagem serverless têm limite de corpo (~4,5 MB), inviável para PDFs de até 25 MB.

**Decisão.** Três etapas, sem o arquivo passar pelo corpo de uma rota:
1. `POST /api/documents/prepare`: valida nome, extensão, tamanho, lote (≤ 20) e duplicidade por SHA-256; devolve URL de envio assinada por arquivo.
2. O navegador envia o arquivo à URL assinada.
3. `POST /api/documents/finalize`: baixa o objeto, confere tamanho, conteúdo real (assinatura `%PDF-` + `%%EOF`; ZIP com `word/document.xml`; UTF-8 sem NUL), e SHA-256; só então grava os metadados. Falhou: remove o objeto e devolve erro claro. O caminho é sempre `<id do usuário autenticado>/<id>/<nome neutralizado>`, nunca vindo do cliente.
4. `GET /api/documents/[id]/download`: URL assinada de 60 s, lida via RLS (documento alheio = 404).

**Limites conhecidos.** (a) A rota `finalize` usa o cliente da sessão do usuário, então um cliente malicioso ainda poderia inserir direto em `documents`. O fechamento está escrito em `supabase/migrations/0005_*` (com reversão `.down.sql`), **não aplicado**, e exige trocar `finalize` para a chave de serviço (somente servidor). (b) O texto extraído ainda vem do cliente; a extração no servidor é a Fase 3.
