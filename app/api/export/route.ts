import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { exportResponse, loadLatestPart, parseFormat } from "@/lib/server/export";
import { ApiError, handleRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const MAX_NOTEBOOKS = 20;

// Exporta vários cadernos (uma disciplina por caderno) numa só apostila: ?notebooks=id1,id2&format=pdf|docx|md
// Ou todos os cadernos de uma disciplina: ?discipline=Direito%20Constitucional
export function GET(request: Request) {
  return handleRoute("export.many", async () => {
    const { supabase } = await requireUser();
    const params = new URL(request.url).searchParams;
    const format = parseFormat(params.get("format") ?? "pdf");
    let ids = (params.get("notebooks") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    const discipline = params.get("discipline")?.trim();
    if (!ids.length && discipline) {
      const { data, error } = await supabase.from("notebooks").select("id").eq("discipline", discipline).order("created_at", { ascending: true }).limit(MAX_NOTEBOOKS);
      if (error) throw new Error(`Falha ao listar cadernos: ${error.message}`);
      ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
    }
    if (!ids.length) throw new ApiError(400, "invalid_request", "Informe notebooks=id1,id2 ou discipline=Nome.");
    if (ids.length > MAX_NOTEBOOKS || ids.some((id) => !UUID_PATTERN.test(id))) throw new ApiError(400, "invalid_request", "Lista de cadernos inválida.");
    const parts = [];
    for (const id of ids) { const part = await loadLatestPart(supabase, id); if (part) parts.push(part); }
    if (!parts.length) throw new ApiError(404, "not_found", "Nenhum dos cadernos tem apostila verificada para exportar.");
    return await exportResponse(discipline ?? "Apostila integrada", parts, format);
  });
}
