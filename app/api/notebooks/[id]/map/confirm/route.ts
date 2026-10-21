import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute, readJson } from "@/lib/server/http";
import { createMapStore } from "@/lib/server/stores";

export const dynamic = "force-dynamic";

// Confirma uma versão do mapa como a aprovada para a redação. Só uma versão fica confirmada por caderno.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("map.confirm", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    const body = await readJson(request);
    if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) throw new ApiError(400, "invalid_request", "Informe a versão a confirmar.");
    const store = createMapStore(supabase);
    const confirmed = await store.confirm(id, body.version);
    if (!confirmed) throw new ApiError(404, "not_found", "Versão do mapa não encontrada.");
    return NextResponse.json({ latest: confirmed, versions: await store.list(id) });
  });
}
