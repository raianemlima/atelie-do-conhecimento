import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute, readJson } from "@/lib/server/http";
import { coveredSegmentIds, parseOperations } from "@/lib/server/map-input";
import { createMapStore } from "@/lib/server/stores";
import { applyOperations, MapError } from "@/lib/thematic/operations";
import { StaleMapError } from "@/lib/thematic/store";

export const dynamic = "force-dynamic";

// Edita o mapa criando uma NOVA versão (a anterior permanece intacta). Exige a versão mais recente como base.
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("map.edit", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    const body = await readJson(request);
    if (typeof body.baseVersion !== "number" || !Number.isInteger(body.baseVersion) || body.baseVersion < 1) throw new ApiError(400, "invalid_request", "Informe a versão do mapa em que as alterações se baseiam.");
    const operations = parseOperations(body.operations);
    const store = createMapStore(supabase);
    const latest = await store.latest(id);
    if (!latest) throw new ApiError(404, "not_found", "Este caderno ainda não tem mapa temático.");
    if (latest.version !== body.baseVersion) throw new ApiError(409, "stale_map", new StaleMapError().message);
    let applied;
    try { applied = applyOperations(latest.map, operations, coveredSegmentIds(latest.map)); }
    catch (error) { if (error instanceof MapError) throw new ApiError(422, "invalid_map_change", error.message); throw error; }
    try {
      const saved = await store.saveEdited({ notebookId: id, baseVersion: latest.version, expectedLatest: latest.version, map: applied.map, changeLog: applied.log });
      return NextResponse.json({ latest: saved, versions: await store.list(id) }, { status: 201 });
    } catch (error) {
      if (error instanceof StaleMapError) throw new ApiError(409, "stale_map", error.message);
      throw error;
    }
  });
}
