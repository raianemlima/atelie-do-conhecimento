import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRow, JobStatus, Json, PipelineDeps, PipelineDocument, PipelineRepository, PlannedStage, StageName, StageRow } from "@/lib/pipeline/types";

type JobDb = { id: string; notebook_id: string; kind: string; status: JobStatus; input_hash: string; error: string | null; created_at: string; updated_at: string; finished_at: string | null };
type StageDb = { id: string; job_id: string; stage: StageName; subject_id: string | null; position: number; status: StageRow["status"]; attempts: number; max_attempts: number; next_attempt_at: string; lease_expires_at: string | null; input_hash: string | null; output: Json | null; cache_hit: boolean; error: string | null; started_at: string | null; finished_at: string | null; duration_ms: number | null; tokens_in: number; tokens_out: number; cost_usd: number | string };

export const toJob = (row: JobDb): JobRow => ({ id: row.id, notebookId: row.notebook_id, kind: row.kind, status: row.status, inputHash: row.input_hash, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at });
export const toStage = (row: StageDb): StageRow => ({ id: row.id, jobId: row.job_id, stage: row.stage, subjectId: row.subject_id, position: row.position, status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, nextAttemptAt: row.next_attempt_at, leaseExpiresAt: row.lease_expires_at, inputHash: row.input_hash, output: row.output, cacheHit: row.cache_hit, error: row.error, startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms, tokensIn: row.tokens_in, tokensOut: row.tokens_out, costUsd: Number(row.cost_usd) });

function check(error: { message: string; code?: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

const ACTIVE_OR_DONE = ["queued", "running", "succeeded"];

// Persistência no Supabase (RLS do usuário). O relógio autoritativo da reivindicação é o do banco.
export class SupabasePipelineRepository implements PipelineRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async createJob(input: { notebookId: string; inputHash: string; stages: PlannedStage[]; maxAttempts: number }) {
    const findExisting = async () => {
      const { data, error } = await this.supabase.from("jobs").select("*").eq("notebook_id", input.notebookId).eq("input_hash", input.inputHash).in("status", ACTIVE_OR_DONE).order("created_at", { ascending: false }).limit(1);
      check(error, "Falha ao consultar jobs existentes");
      return data && data.length ? toJob(data[0] as JobDb) : null;
    };
    const existing = await findExisting();
    if (existing) return { job: existing, created: false };
    const { data, error } = await this.supabase.from("jobs").insert({ notebook_id: input.notebookId, input_hash: input.inputHash }).select("*").single();
    if (error?.code === "23505") {
      const raced = await findExisting();
      if (raced) return { job: raced, created: false };
    }
    check(error, "Falha ao criar o job");
    const job = toJob(data as JobDb);
    const rows = input.stages.map((planned) => ({ job_id: job.id, stage: planned.stage, subject_id: planned.subjectId, position: planned.position, max_attempts: input.maxAttempts }));
    const inserted = await this.supabase.from("job_stages").insert(rows);
    if (inserted.error) {
      // supabase-js não oferece transação: desfaz o job para não deixar um job sem etapas.
      await this.supabase.from("jobs").delete().eq("id", job.id);
      check(inserted.error, "Falha ao planejar as etapas do job");
    }
    return { job, created: true };
  }

  async getJob(jobId: string) {
    const { data, error } = await this.supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
    check(error, "Falha ao carregar o job");
    return data ? toJob(data as JobDb) : null;
  }

  async listStages(jobId: string) {
    const { data, error } = await this.supabase.from("job_stages").select("*").eq("job_id", jobId).order("position");
    check(error, "Falha ao carregar as etapas");
    return ((data ?? []) as StageDb[]).map(toStage);
  }

  async claimNextStage(jobId: string, _now: Date, leaseMs: number) {
    const { data, error } = await this.supabase.rpc("claim_next_stage", { p_job_id: jobId, p_lease_seconds: Math.max(1, Math.round(leaseMs / 1000)) });
    check(error, "Falha ao reivindicar a próxima etapa");
    const rows = (data ?? []) as StageDb[];
    return rows.length ? toStage(rows[0]) : null;
  }

  async completeStage(stageId: string, result: { output: Json; inputHash: string; cacheHit: boolean; durationMs: number; tokensIn: number; tokensOut: number; costUsd: number }) {
    const { error } = await this.supabase.from("job_stages").update({ status: "succeeded", output: result.output, input_hash: result.inputHash, cache_hit: result.cacheHit, duration_ms: result.durationMs, tokens_in: result.tokensIn, tokens_out: result.tokensOut, cost_usd: result.costUsd, error: null, lease_expires_at: null, finished_at: new Date().toISOString() }).eq("id", stageId);
    check(error, "Falha ao registrar a etapa concluída");
  }

  async failStage(stageId: string, message: string, durationMs: number) {
    const { error } = await this.supabase.from("job_stages").update({ status: "failed", error: message, duration_ms: durationMs, lease_expires_at: null, finished_at: new Date().toISOString() }).eq("id", stageId);
    check(error, "Falha ao registrar a falha da etapa");
  }

  async scheduleRetry(stageId: string, nextAttemptAt: Date, message: string, durationMs: number) {
    const { error } = await this.supabase.from("job_stages").update({ status: "pending", error: message, duration_ms: durationMs, next_attempt_at: nextAttemptAt.toISOString(), lease_expires_at: null }).eq("id", stageId);
    check(error, "Falha ao agendar a nova tentativa");
  }

  async setJobStatus(jobId: string, status: JobStatus, message: string | null = null) {
    const stamp = new Date().toISOString();
    const finished = status === "succeeded" || status === "failed" || status === "cancelled";
    const { error } = await this.supabase.from("jobs").update({ status, error: message, updated_at: stamp, finished_at: finished ? stamp : null }).eq("id", jobId);
    check(error, "Falha ao atualizar o status do job");
  }

  async getCached(stage: StageName, inputHash: string) {
    const { data, error } = await this.supabase.from("stage_cache").select("output").eq("stage", stage).eq("input_hash", inputHash).maybeSingle();
    check(error, "Falha ao consultar o cache");
    return (data?.output as Json | undefined) ?? null;
  }

  async putCached(stage: StageName, inputHash: string, output: Json) {
    const { error } = await this.supabase.from("stage_cache").upsert({ stage, input_hash: inputHash, output }, { onConflict: "owner_id,stage,input_hash", ignoreDuplicates: true });
    check(error, "Falha ao gravar o cache");
  }
}

export function supabasePipelineDeps(supabase: SupabaseClient): PipelineDeps {
  return {
    async loadDocument(id: string): Promise<PipelineDocument | null> {
      const { data, error } = await supabase.from("documents").select("id, sha256, extraction_status, page_texts, page_count").eq("id", id).maybeSingle();
      check(error, "Falha ao carregar o documento");
      if (!data) return null;
      return { id: data.id, sha256: data.sha256, extractionStatus: data.extraction_status, pageTexts: (data.page_texts as string[] | null) ?? [], pageCount: data.page_count };
    },
  };
}
