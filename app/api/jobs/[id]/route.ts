import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute } from "@/lib/server/http";
import { loadJobView } from "@/lib/server/pipeline";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("jobs.get", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do job inválido.");
    const view = await loadJobView(supabase, id);
    if (!view) throw new ApiError(404, "not_found", "Job não encontrado.");
    return NextResponse.json({ view });
  });
}
