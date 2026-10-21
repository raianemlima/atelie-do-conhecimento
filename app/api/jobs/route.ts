import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { UUID_PATTERN } from "@/lib/server/documents";
import { ApiError, handleRoute, readJson } from "@/lib/server/http";
import { listJobs, loadNotebookSettings, parseSettingsOrThrow, toJobView } from "@/lib/server/pipeline";
import { isDefaultSettings, type CleaningSettings } from "@/lib/pipeline/options";
import { DEFAULT_HANDLERS } from "@/lib/pipeline/handlers";
import { DEFAULT_MAX_ATTEMPTS } from "@/lib/pipeline/engine";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import { SupabasePipelineRepository } from "@/lib/pipeline/supabase-repository";

export const dynamic = "force-dynamic";
const MAX_SOURCES = 50;

export function GET(request: Request) {
  return handleRoute("jobs.list", async () => {
    const { supabase } = await requireUser();
    const activeOnly = new URL(request.url).searchParams.get("active") === "1";
    return NextResponse.json({ jobs: await listJobs(supabase, activeOnly) });
  });
}

// Cria (ou reaproveita) o caderno e o job. Idempotente: mesmas fontes (por hash) = mesmo job.
export function POST(request: Request) {
  return handleRoute("jobs.create", async () => {
    const { supabase } = await requireUser();
    const body = await readJson(request);
    let notebookId = typeof body.notebookId === "string" ? body.notebookId : null;
    if (notebookId !== null && !UUID_PATTERN.test(notebookId)) throw new ApiError(400, "invalid_request", "Identificador do caderno inválido.");
    if (notebookId !== null && body.options !== undefined) throw new ApiError(400, "invalid_request", "As opções de limpeza pertencem ao caderno. Crie um novo caderno para mudá-las.");
    let settings: CleaningSettings | null = notebookId ? null : parseSettingsOrThrow(body.options);

    if (!notebookId) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const documentIds = Array.isArray(body.documentIds) ? (body.documentIds as unknown[]) : [];
      if (!name || name.length > 200) throw new ApiError(400, "invalid_request", "Informe um nome de caderno com até 200 caracteres.");
      if (!documentIds.length || documentIds.length > MAX_SOURCES || !documentIds.every((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))) throw new ApiError(400, "invalid_request", `Selecione de 1 a ${MAX_SOURCES} documentos válidos.`);
      const uniqueIds = [...new Set(documentIds)];
      const { data: owned, error: docsError } = await supabase.from("documents").select("id").in("id", uniqueIds);
      if (docsError) throw new Error(`Falha ao validar documentos: ${docsError.message}`);
      if ((owned ?? []).length !== uniqueIds.length) throw new ApiError(404, "not_found", "Um ou mais documentos não foram encontrados.");
      const optionColumns = settings && !isDefaultSettings(settings) ? { known_terms: settings.knownTerms, keep_references: settings.keepReferences, keep_professors: settings.keepProfessors } : {};
      const { data: notebook, error: notebookError } = await supabase.from("notebooks").insert({ name, ...optionColumns }).select("id").single();
      if (notebookError || !notebook) throw new Error(`Falha ao criar o caderno: ${notebookError?.message ?? "resposta vazia"}`);
      notebookId = notebook.id as string;
      const linked = await supabase.from("notebook_sources").insert(uniqueIds.map((documentId) => ({ notebook_id: notebookId, document_id: documentId })));
      if (linked.error) {
        await supabase.from("notebooks").delete().eq("id", notebookId);
        throw new Error(`Falha ao vincular as fontes: ${linked.error.message}`);
      }
    }

    settings = settings ?? (await loadNotebookSettings(supabase, notebookId));
    if (!settings) throw new ApiError(404, "not_found", "Caderno não encontrado ou sem fontes.");
    const { data: sources, error: sourcesError } = await supabase.from("notebook_sources").select("document_id").eq("notebook_id", notebookId);
    if (sourcesError) throw new Error(`Falha ao carregar as fontes do caderno: ${sourcesError.message}`);
    if (!sources || !sources.length) throw new ApiError(404, "not_found", "Caderno não encontrado ou sem fontes.");
    const ids = sources.map((row: { document_id: string }) => row.document_id);
    const { data: documents, error: documentsError } = await supabase.from("documents").select("id, sha256").in("id", ids);
    if (documentsError) throw new Error(`Falha ao carregar os documentos: ${documentsError.message}`);

    const docs = (documents ?? []) as { id: string; sha256: string }[];
    const repo = new SupabasePipelineRepository(supabase);
    const { job, created } = await repo.createJob({ notebookId, inputHash: jobInputHash(docs, DEFAULT_HANDLERS, settings), stages: planStages(docs, DEFAULT_HANDLERS), maxAttempts: DEFAULT_MAX_ATTEMPTS });
    return NextResponse.json({ created, view: toJobView(job, await repo.listStages(job.id)) }, { status: created ? 201 : 200 });
  });
}
