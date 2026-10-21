import { randomUUID } from "node:crypto";
import type { JobRow, JobStatus, Json, PipelineRepository, PlannedStage, StageName, StageRow } from "@/lib/pipeline/types";

// Implementação em memória com a MESMA semântica do banco (ordem estrita, lease, tentativas); usada em testes.
export class MemoryPipelineRepository implements PipelineRepository {
  readonly jobs = new Map<string, JobRow>();
  readonly stages = new Map<string, StageRow>();
  readonly cache = new Map<string, Json>();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async createJob(input: { notebookId: string; inputHash: string; stages: PlannedStage[]; maxAttempts: number }) {
    const existing = [...this.jobs.values()].find((job) => job.notebookId === input.notebookId && job.inputHash === input.inputHash && ["queued", "running", "succeeded"].includes(job.status));
    if (existing) return { job: existing, created: false };
    const stamp = this.clock().toISOString();
    const job: JobRow = { id: randomUUID(), notebookId: input.notebookId, kind: "build_notebook", status: "queued", inputHash: input.inputHash, error: null, createdAt: stamp, updatedAt: stamp, finishedAt: null };
    this.jobs.set(job.id, job);
    for (const planned of input.stages) {
      const row: StageRow = { id: randomUUID(), jobId: job.id, stage: planned.stage, subjectId: planned.subjectId, position: planned.position, status: "pending", attempts: 0, maxAttempts: input.maxAttempts, nextAttemptAt: stamp, leaseExpiresAt: null, inputHash: null, output: null, cacheHit: false, error: null, startedAt: null, finishedAt: null, durationMs: null, tokensIn: 0, tokensOut: 0, costUsd: 0 };
      this.stages.set(row.id, row);
    }
    return { job, created: true };
  }

  async getJob(jobId: string) { return this.jobs.get(jobId) ?? null; }

  async listStages(jobId: string) { return [...this.stages.values()].filter((row) => row.jobId === jobId).sort((a, b) => a.position - b.position).map((row) => ({ ...row })); }

  async claimNextStage(jobId: string, now: Date, leaseMs: number) {
    const candidate = (await this.listStages(jobId)).find((row) => row.status !== "succeeded" && row.status !== "skipped");
    if (!candidate) return null;
    const row = this.stages.get(candidate.id) as StageRow;
    const pendingReady = row.status === "pending" && new Date(row.nextAttemptAt) <= now;
    const leaseExpired = row.status === "running" && row.leaseExpiresAt !== null && new Date(row.leaseExpiresAt) < now;
    if (!pendingReady && !leaseExpired) return null;
    if (leaseExpired && row.attempts >= row.maxAttempts) {
      row.status = "failed";
      row.error = "A etapa foi interrompida e esgotou as tentativas.";
      row.finishedAt = now.toISOString();
      return null;
    }
    row.status = "running";
    row.attempts += 1;
    row.startedAt = row.startedAt ?? now.toISOString();
    row.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    return { ...row };
  }

  private mustGet(stageId: string) { const row = this.stages.get(stageId); if (!row) throw new Error(`Etapa ${stageId} inexistente.`); return row; }

  async completeStage(stageId: string, result: { output: Json; inputHash: string; cacheHit: boolean; durationMs: number; tokensIn: number; tokensOut: number; costUsd: number }) {
    const row = this.mustGet(stageId);
    Object.assign(row, { status: "succeeded", output: result.output, inputHash: result.inputHash, cacheHit: result.cacheHit, durationMs: result.durationMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd, error: null, leaseExpiresAt: null, finishedAt: this.clock().toISOString() });
  }

  async failStage(stageId: string, error: string, durationMs: number) {
    Object.assign(this.mustGet(stageId), { status: "failed", error, durationMs, leaseExpiresAt: null, finishedAt: this.clock().toISOString() });
  }

  async scheduleRetry(stageId: string, nextAttemptAt: Date, error: string, durationMs: number) {
    Object.assign(this.mustGet(stageId), { status: "pending", error, durationMs, nextAttemptAt: nextAttemptAt.toISOString(), leaseExpiresAt: null });
  }

  async setJobStatus(jobId: string, status: JobStatus, error: string | null = null) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} inexistente.`);
    const stamp = this.clock().toISOString();
    Object.assign(job, { status, error, updatedAt: stamp, finishedAt: ["succeeded", "failed", "cancelled"].includes(status) ? stamp : null });
  }

  async getCached(stage: StageName, inputHash: string) { return this.cache.get(`${stage}:${inputHash}`) ?? null; }
  async putCached(stage: StageName, inputHash: string, output: Json) { this.cache.set(`${stage}:${inputHash}`, output); }
}
