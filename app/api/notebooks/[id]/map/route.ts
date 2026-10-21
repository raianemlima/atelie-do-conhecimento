import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute } from "@/lib/server/http";
import { createMapStore } from "@/lib/server/stores";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("map.get", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    const store = createMapStore(supabase);
    const latest = await store.latest(id);
    if (!latest) throw new ApiError(404, "not_found", "Este caderno ainda não tem mapa temático.");
    return NextResponse.json({ latest, versions: await store.list(id) });
  });
}
