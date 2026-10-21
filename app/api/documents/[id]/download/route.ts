import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { SIGNED_URL_TTL_SECONDS, UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("documents.download", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do documento inválido.");
    // A leitura passa pela RLS: documentos de outros usuários são indistinguíveis de inexistentes.
    const { data: row, error } = await supabase.from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
    if (error) throw new Error(`Falha ao consultar o documento: ${error.message}`);
    if (!row) throw new ApiError(404, "not_found", "Documento não encontrado.");
    const signed = await supabase.storage.from("documents").createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, { download: row.file_name });
    if (signed.error || !signed.data) throw new Error(`Falha ao assinar a URL: ${signed.error?.message ?? "resposta vazia"}`);
    return NextResponse.json({ url: signed.data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  });
}
