import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { exportResponse, loadLatestPart, parseFormat } from "@/lib/server/export";
import { ApiError, handleRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Exporta a apostila verificada de um caderno: ?format=pdf|docx|md
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("export.notebook", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    const format = parseFormat(new URL(request.url).searchParams.get("format") ?? "pdf");
    const part = await loadLatestPart(supabase, id);
    if (!part) throw new ApiError(404, "not_found", "Este caderno ainda não tem apostila verificada para exportar.");
    return await exportResponse(part.name, [part], format);
  });
}
