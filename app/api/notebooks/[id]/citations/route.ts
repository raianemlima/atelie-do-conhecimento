import { NextResponse } from "next/server";
import type { CitationRegistry } from "@/lib/citations/types";
import { SupabasePipelineRepository, toJob } from "@/lib/pipeline/supabase-repository";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Registro de citações do caderno: saída da etapa citation_registry do job concluído mais recente.
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute("citations.get", async () => {
    const { supabase } = await requireUser();
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    const { data, error } = await supabase.from("jobs").select("*").eq("notebook_id", id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(5);
    if (error) throw new Error(`Falha ao listar jobs: ${error.message}`);
    const repo = new SupabasePipelineRepository(supabase);
    for (const row of (data ?? []) as Parameters<typeof toJob>[0][]) {
      const stage = (await repo.listStages(toJob(row).id)).find((candidate) => candidate.stage === "citation_registry" && candidate.status === "succeeded");
      if (stage?.output) return NextResponse.json({ registry: stage.output as unknown as CitationRegistry, jobId: row.id });
    }
    throw new ApiError(404, "not_found", "Este caderno ainda não tem registro de citações.");
  });
}
