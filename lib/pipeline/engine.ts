import { stageInputHash } from "@/lib/pipeline/hash";
import { StageError, summarizeProgress, type Json, type PipelineDeps, type PipelineRepository, type StageHandler, type StageName, type StageRow, type StepOutcome } from "@/lib/pipeline/types";

export type StageLogEntry = { jobId: string; stage: StageName; subjectId: string | null; status: "ok" | "cache-hit" | "retry" | "failed"; attempt: number; durationMs: number; tokensIn: number; tokensOut: number; costUsd: number };

export type EngineOptions = {
  now?: () => Date;
  leaseMs?: number;
  stepTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  jitter?: () => number;
  log?: (entry: StageLogEntry) => void;
};

export const DEFAULT_MAX_ATTEMPTS = 3;

export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number, jitter: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (1 + jitter));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StageError(`A etapa excedeu o tempo limite de ${ms} ms.`, true)), ms); });
  try { return await Promise.race([work, timeout]); } finally { if (timer) clearTimeout(timer); }
}

function isJson(value: unknown): value is Json {
  try { return value !== undefined && JSON.stringify(value) !== undefined; } catch { return false; }
}

// Executa no máximo UMA etapa curta e persiste o resultado. Pode ser chamada repetidamente, por qualquer
// instância, a qualquer momento: a retomada após falha e a idempotência vêm do estado gravado, não da memória.
export async function advanceJob(repo: PipelineRepository, handlers: StageHandler[], deps: PipelineDeps, jobId: string, options: EngineOptions = {}): Promise<StepOutcome> {
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 60_000;
  const stepTimeoutMs = options.stepTimeoutMs ?? 20_000;
  const job = await repo.getJob(jobId);
  if (!job) throw new StageError("Job não encontrado.", false);
  if (job.status === "succeeded") return { kind: "done" };
  if (job.status === "failed" || job.status === "cancelled") return { kind: "failed", error: job.error ?? "O processamento foi interrompido." };
  if (job.status === "queued") await repo.setJobStatus(jobId, "running");

  const claimed = await repo.claimNextStage(jobId, now(), leaseMs);
  if (!claimed) return settle(repo, jobId, now());

  const started = Date.now();
  const handler = handlers.find((candidate) => candidate.stage === claimed.stage);
  const finishFailure = async (message: string) => {
    await repo.failStage(claimed.id, message, Date.now() - started);
    await repo.setJobStatus(jobId, "failed", `Etapa "${claimed.stage}" falhou: ${message}`);
    options.log?.({ jobId, stage: claimed.stage, subjectId: claimed.subjectId, status: "failed", attempt: claimed.attempts, durationMs: Date.now() - started, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    return { kind: "failed", error: message } as const;
  };
  if (!handler) return finishFailure("Etapa sem implementação registrada.");

  const stages = await repo.listStages(jobId);
  const context = { job, stage: claimed, stages, deps };
  try {
    const inputHash = stageInputHash(handler.stage, handler.version, await handler.inputKey(context));
    const cached = handler.cache === false ? null : await repo.getCached(handler.stage, inputHash);
    if (cached !== null) {
      await repo.completeStage(claimed.id, { output: cached, inputHash, cacheHit: true, durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
      options.log?.({ jobId, stage: claimed.stage, subjectId: claimed.subjectId, status: "cache-hit", attempt: claimed.attempts, durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
      return { kind: "progressed", stage: claimed.stage, subjectId: claimed.subjectId, cacheHit: true };
    }
    const result = await withTimeout(handler.run(context), stepTimeoutMs);
    if (!isJson(result?.output)) throw new StageError("A etapa devolveu uma saída inválida ou vazia.", true);
    const durationMs = Date.now() - started;
    const usage = { tokensIn: result.tokensIn ?? 0, tokensOut: result.tokensOut ?? 0, costUsd: result.costUsd ?? 0 };
    if (handler.cache !== false) await repo.putCached(handler.stage, inputHash, result.output);
    await repo.completeStage(claimed.id, { output: result.output, inputHash, cacheHit: false, durationMs, ...usage });
    options.log?.({ jobId, stage: claimed.stage, subjectId: claimed.subjectId, status: "ok", attempt: claimed.attempts, durationMs, ...usage });
    return { kind: "progressed", stage: claimed.stage, subjectId: claimed.subjectId, cacheHit: false };
  } catch (error) {
    const retryable = error instanceof StageError ? error.retryable : true;
    if (!retryable || claimed.attempts >= claimed.maxAttempts) return finishFailure(retryable ? `${describe(error)} (esgotadas ${claimed.maxAttempts} tentativas)` : describe(error));
    const delay = backoffDelayMs(claimed.attempts, options.backoffBaseMs ?? 2_000, options.backoffMaxMs ?? 60_000, options.jitter?.() ?? 0);
    const retryAt = new Date(now().getTime() + delay);
    await repo.scheduleRetry(claimed.id, retryAt, describe(error), Date.now() - started);
    options.log?.({ jobId, stage: claimed.stage, subjectId: claimed.subjectId, status: "retry", attempt: claimed.attempts, durationMs: Date.now() - started, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    return { kind: "waiting", retryAt: retryAt.toISOString() };
  }
}

async function settle(repo: PipelineRepository, jobId: string, now: Date): Promise<StepOutcome> {
  const stages = await repo.listStages(jobId);
  const failed = stages.find((stage) => stage.status === "failed");
  if (failed) {
    const error = failed.error ?? "Etapa falhou.";
    await repo.setJobStatus(jobId, "failed", `Etapa "${failed.stage}" falhou: ${error}`);
    return { kind: "failed", error };
  }
  if (summarizeProgress(stages).done === stages.length) {
    await repo.setJobStatus(jobId, "succeeded");
    return { kind: "done" };
  }
  const waiting = stages.filter((stage: StageRow) => stage.status === "pending" && new Date(stage.nextAttemptAt) > now).sort((a, b) => a.position - b.position)[0];
  return waiting ? { kind: "waiting", retryAt: waiting.nextAttemptAt } : { kind: "busy" };
}
