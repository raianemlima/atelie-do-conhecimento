import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobView } from "@/lib/pipeline/dto";
import { DEFAULT_CLEANING_SETTINGS, parseCleaningSettings, SettingsError, type CleaningSettings } from "@/lib/pipeline/options";
import { ApiError } from "@/lib/server/http";
import { summarizeProgress, type JobRow, type StageRow } from "@/lib/pipeline/types";
import { SupabasePipelineRepository, toJob } from "@/lib/pipeline/supabase-repository";

export function toJobView(job: JobRow, stages: StageRow[]): JobView {
  return {
    job,
    progress: summarizeProgress(stages),
    stages: stages.map(({ id, stage, subjectId, position, status, attempts, maxAttempts, nextAttemptAt, error, cacheHit, durationMs, tokensIn, tokensOut, costUsd }) => ({ id, stage, subjectId, position, status, attempts, maxAttempts, nextAttemptAt, error, cacheHit, durationMs, tokensIn, tokensOut, costUsd })),
  };
}

export async function loadJobView(supabase: SupabaseClient, jobId: string): Promise<JobView | null> {
  const repo = new SupabasePipelineRepository(supabase);
  const job = await repo.getJob(jobId);
  return job ? toJobView(job, await repo.listStages(jobId)) : null;
}

export async function listJobs(supabase: SupabaseClient, activeOnly: boolean): Promise<JobView[]> {
  let query = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(20);
  if (activeOnly) query = query.in("status", ["queued", "running"]);
  const { data, error } = await query;
  if (error) throw new Error(`Falha ao listar jobs: ${error.message}`);
  const repo = new SupabasePipelineRepository(supabase);
  const jobs = ((data ?? []) as Parameters<typeof toJob>[0][]).map(toJob);
  return Promise.all(jobs.map(async (job) => toJobView(job, await repo.listStages(job.id))));
}


export function parseSettingsOrThrow(raw: unknown): CleaningSettings {
  try { return parseCleaningSettings(raw); }
  catch (error) { if (error instanceof SettingsError) throw new ApiError(400, "invalid_request", error.message); throw error; }
}

export type NotebookInfo = { name: string; discipline: string; settings: CleaningSettings };

// Lê nome, disciplina e opções de limpeza do caderno. Usa "*" para continuar funcionando em bancos sem a migração 0007.
export async function loadNotebook(supabase: SupabaseClient, notebookId: string): Promise<NotebookInfo | null> {
  const { data, error } = await supabase.from("notebooks").select("*").eq("id", notebookId).maybeSingle();
  if (error) throw new Error(`Falha ao carregar o caderno: ${error.message}`);
  if (!data) return null;
  const row = data as { name?: string; discipline?: string | null; known_terms?: string[] | null; keep_references?: string[] | null; keep_professors?: boolean | null };
  return { name: row.name ?? "", discipline: row.discipline?.trim() || row.name || "", settings: { ...DEFAULT_CLEANING_SETTINGS, knownTerms: row.known_terms ?? [], keepReferences: row.keep_references ?? [], keepProfessors: row.keep_professors === true } };
}

export async function loadNotebookSettings(supabase: SupabaseClient, notebookId: string): Promise<CleaningSettings | null> {
  return (await loadNotebook(supabase, notebookId))?.settings ?? null;
}
