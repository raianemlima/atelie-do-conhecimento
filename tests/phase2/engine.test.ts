import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceJob, backoffDelayMs, type EngineOptions, type StageLogEntry } from "@/lib/pipeline/engine";
import { LEGACY_HANDLERS as DEFAULT_HANDLERS } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import { StageError, summarizeProgress, type PipelineDeps, type PipelineDocument, type StageHandler, type StepOutcome } from "@/lib/pipeline/types";
import { extractCorpus } from "../helpers";

let nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
const clock = () => new Date(nowMs);
const advanceTime = (ms: number) => { nowMs += ms; };

const doc = (id: string, sha: string, pages: string[]): PipelineDocument => ({ id, format: "pdf", sha256: sha, extractionStatus: "text", pageTexts: pages, pageCount: pages.length });
const depsOf = (...documents: PipelineDocument[]): PipelineDeps => ({ loadDocument: async (id) => documents.find((d) => d.id === id) ?? null });

async function startJob(repo: MemoryPipelineRepository, documents: PipelineDocument[], handlers: StageHandler[], notebookId = "nb-1") {
  return repo.createJob({ notebookId, inputHash: jobInputHash(documents, handlers), stages: planStages(documents, handlers), maxAttempts: 3 });
}

async function runToEnd(repo: MemoryPipelineRepository, handlers: StageHandler[], deps: PipelineDeps, jobId: string, options: EngineOptions = {}, maxSteps = 50): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const outcome = await advanceJob(repo, handlers, deps, jobId, { now: clock, ...options });
    outcomes.push(outcome);
    if (outcome.kind === "done" || outcome.kind === "failed") break;
    if (outcome.kind === "waiting") advanceTime(new Date(outcome.retryAt).getTime() - nowMs + 1);
  }
  return outcomes;
}

beforeEach(() => { nowMs = Date.UTC(2026, 0, 1, 12, 0, 0); });

describe("planejamento e idempotência", () => {
  const docs = [doc("b", "h2", ["B"]), doc("a", "h1", ["A"])];
  it("cria uma etapa por documento e por estágio, em ordem estrita", () => {
    const plan = planStages(docs, DEFAULT_HANDLERS);
    expect(plan.map((p) => `${p.stage}:${p.subjectId}`)).toEqual(["extraction:a", "extraction:b", "cleaning:a", "cleaning:b"]);
    expect(plan.map((p) => p.position)).toEqual([1, 2, 3, 4]);
  });
  it("o hash do job independe da ordem das fontes e muda com o conteúdo", () => {
    expect(jobInputHash(docs, DEFAULT_HANDLERS)).toBe(jobInputHash([...docs].reverse(), DEFAULT_HANDLERS));
    expect(jobInputHash(docs, DEFAULT_HANDLERS)).not.toBe(jobInputHash([docs[0], doc("c", "h3", ["C"])], DEFAULT_HANDLERS));
  });
  it("criar o mesmo job duas vezes não duplica", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const first = await startJob(repo, docs, DEFAULT_HANDLERS);
    const second = await startJob(repo, docs, DEFAULT_HANDLERS);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(repo.stages.size).toBe(4);
  });
});

describe("execução", () => {
  it("processa todas as etapas, uma por chamada, e conclui o job", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["Texto A"]), doc("b", "h2", ["Texto B"])];
    const { job } = await startJob(repo, docs, DEFAULT_HANDLERS);
    const outcomes = await runToEnd(repo, DEFAULT_HANDLERS, depsOf(...docs), job.id);
    expect(outcomes.map((o) => o.kind)).toEqual(["progressed", "progressed", "progressed", "progressed", "done"]);
    expect((await repo.getJob(job.id))?.status).toBe("succeeded");
    expect(summarizeProgress(await repo.listStages(job.id))).toMatchObject({ done: 4, total: 4, percent: 100 });
  });
  it("reexecutar um job concluído não faz nada (idempotente, custo zero)", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const run = vi.fn(DEFAULT_HANDLERS[0].run);
    const handlers = [{ ...DEFAULT_HANDLERS[0], run }, DEFAULT_HANDLERS[1]];
    const { job } = await startJob(repo, docs, handlers);
    await runToEnd(repo, handlers, depsOf(...docs), job.id);
    const calls = run.mock.calls.length;
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("done");
    expect(run.mock.calls.length).toBe(calls);
  });
  it("duas chamadas simultâneas não executam a mesma etapa duas vezes", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const run = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return { output: { ok: true } }; });
    const handlers: StageHandler[] = [{ stage: "extraction", scope: "document", version: "1", inputKey: () => "k", run }];
    const { job } = await startJob(repo, docs, handlers);
    const [first, second] = await Promise.all([advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock }), advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })]);
    expect([first.kind, second.kind].sort()).toEqual(["busy", "progressed"]);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("registra log estruturado sem conteúdo de documentos", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["SEGREDO-DO-DOCUMENTO"])];
    const logs: StageLogEntry[] = [];
    const { job } = await startJob(repo, docs, DEFAULT_HANDLERS);
    await runToEnd(repo, DEFAULT_HANDLERS, depsOf(...docs), job.id, { log: (e) => logs.push(e) });
    expect(logs.map((l) => `${l.stage}:${l.status}`)).toEqual(["extraction:ok", "cleaning:ok"]);
    expect(JSON.stringify(logs)).not.toContain("SEGREDO");
    expect(Object.keys(logs[0]).sort()).toEqual(["attempt", "costUsd", "durationMs", "jobId", "stage", "status", "subjectId", "tokensIn", "tokensOut"]);
  });
});

describe("cache por hash", () => {
  it("o mesmo PDF em outro caderno nunca é processado de novo", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["Texto A"])];
    const run = vi.fn(DEFAULT_HANDLERS[0].run);
    const handlers = [{ ...DEFAULT_HANDLERS[0], run }, DEFAULT_HANDLERS[1]];
    const first = await startJob(repo, docs, handlers, "nb-1");
    await runToEnd(repo, handlers, depsOf(...docs), first.job.id);
    expect(run).toHaveBeenCalledTimes(1);
    const second = await startJob(repo, docs, handlers, "nb-2");
    expect(second.created).toBe(true);
    await runToEnd(repo, handlers, depsOf(...docs), second.job.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await repo.listStages(second.job.id)).every((s) => s.cacheHit && s.costUsd === 0 && s.tokensIn === 0)).toBe(true);
  });
  it("mudar a versão do estágio invalida o cache", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const run = vi.fn(DEFAULT_HANDLERS[0].run);
    const v1: StageHandler[] = [{ ...DEFAULT_HANDLERS[0], run }];
    const v2: StageHandler[] = [{ ...DEFAULT_HANDLERS[0], version: "2", run }];
    await runToEnd(repo, v1, depsOf(...docs), (await startJob(repo, docs, v1, "nb-1")).job.id);
    await runToEnd(repo, v2, depsOf(...docs), (await startJob(repo, docs, v2, "nb-2")).job.id);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("falha, retentativa e retomada", () => {
  const flaky = (failures: number, error: () => Error = () => new Error("IA indisponível")) => {
    let calls = 0;
    const run = vi.fn(async () => { calls += 1; if (calls <= failures) throw error(); return { output: { ok: true } }; });
    const handlers: StageHandler[] = [{ stage: "extraction", scope: "document", version: "1", inputKey: () => "k", run }];
    return { run, handlers };
  };

  it("backoff exponencial com teto", () => {
    expect([1, 2, 3, 4, 10].map((n) => backoffDelayMs(n, 2000, 60000, 0))).toEqual([2000, 4000, 8000, 16000, 60000]);
    expect(backoffDelayMs(1, 2000, 60000, 0.5)).toBe(3000);
  });
  it("tenta de novo com backoff e conclui quando a falha passa", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { run, handlers } = flaky(2);
    const { job } = await startJob(repo, docs, handlers);
    const first = await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock });
    expect(first).toMatchObject({ kind: "waiting" });
    expect(new Date((first as { retryAt: string }).retryAt).getTime() - nowMs).toBe(2000);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("waiting");
    advanceTime(2001);
    const second = await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock });
    expect(new Date((second as { retryAt: string }).retryAt).getTime() - nowMs).toBe(4000);
    advanceTime(4001);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("progressed");
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("esgota as tentativas, falha o job com mensagem clara e não retenta mais", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { run, handlers } = flaky(99);
    const { job } = await startJob(repo, docs, handlers);
    const outcomes = await runToEnd(repo, handlers, depsOf(...docs), job.id);
    expect(outcomes.at(-1)).toMatchObject({ kind: "failed" });
    expect(run).toHaveBeenCalledTimes(3);
    const stored = await repo.getJob(job.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toMatch(/extraction.*IA indisponível.*esgotadas 3 tentativas/);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("failed");
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("erro não retentável falha de imediato", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { run, handlers } = flaky(99, () => new StageError("Resposta fora do schema", false));
    const { job } = await startJob(repo, docs, handlers);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("failed");
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("saída inválida (undefined) conta como falha, nunca como sucesso", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const handlers: StageHandler[] = [{ stage: "extraction", scope: "document", version: "1", inputKey: () => "k", run: async () => ({ output: undefined as never }) }];
    const { job } = await startJob(repo, docs, handlers);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("waiting");
    expect((await repo.listStages(job.id))[0].status).toBe("pending");
  });
  it("estouro de tempo da etapa vira retentativa", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const handlers: StageHandler[] = [{ stage: "extraction", scope: "document", version: "1", inputKey: () => "k", run: () => new Promise(() => {}) }];
    const { job } = await startJob(repo, docs, handlers);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock, stepTimeoutMs: 20 })).kind).toBe("waiting");
    expect((await repo.listStages(job.id))[0].error).toMatch(/tempo limite/);
  });
  it("falha no meio: etapas já concluídas NÃO rodam de novo na retomada", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["A"]), doc("b", "h2", ["B"]), doc("c", "h3", ["C"])];
    let failC = true;
    const calls: string[] = [];
    const handlers: StageHandler[] = [{ stage: "extraction", scope: "document", version: "1", inputKey: ({ stage }) => stage.subjectId ?? "", run: async ({ stage }) => { calls.push(stage.subjectId ?? ""); if (stage.subjectId === "c" && failC) throw new Error("queda de rede"); return { output: { id: stage.subjectId } }; } }];
    const { job } = await startJob(repo, docs, handlers);
    for (let i = 0; i < 4; i += 1) await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock });
    expect(calls).toEqual(["a", "b", "c"]);
    failC = false;
    advanceTime(2001);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("progressed");
    expect(calls).toEqual(["a", "b", "c", "c"]);
  });
  it("retoma uma etapa abandonada quando a lease expira (processo morreu)", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { run, handlers } = flaky(0);
    const { job } = await startJob(repo, docs, handlers);
    const claimed = await repo.claimNextStage(job.id, clock(), 60_000);
    expect(claimed?.status).toBe("running");
    await repo.setJobStatus(job.id, "running");
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("busy");
    advanceTime(60_001);
    expect((await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock })).kind).toBe("progressed");
    expect(run).toHaveBeenCalledTimes(1);
    expect((await repo.listStages(job.id))[0].attempts).toBe(2);
  });
  it("uma etapa que sempre derruba o processo não é retomada para sempre", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { handlers } = flaky(0);
    const { job } = await startJob(repo, docs, handlers);
    await repo.setJobStatus(job.id, "running");
    for (let i = 0; i < 3; i += 1) { await repo.claimNextStage(job.id, clock(), 1000); advanceTime(1001); }
    const outcome = await advanceJob(repo, handlers, depsOf(...docs), job.id, { now: clock });
    expect(outcome.kind).toBe("failed");
  });
  it("documento removido durante o processamento falha com mensagem acionável", async () => {
    const repo = new MemoryPipelineRepository(clock);
    const docs = [doc("a", "h1", ["T"])];
    const { job } = await startJob(repo, docs, DEFAULT_HANDLERS);
    const outcome = await advanceJob(repo, DEFAULT_HANDLERS, depsOf(), job.id, { now: clock });
    expect(outcome).toMatchObject({ kind: "failed", error: expect.stringContaining("Documento da fonte não encontrado") });
  });
});

describe("integração com o golden corpus (extração real + estágios)", () => {
  it("04-ruidoso: o estágio de limpeza reproduz o comportamento atual e fica persistido", async () => {
    const extraction = await extractCorpus("04-ruidoso.pdf");
    const document: PipelineDocument = { id: "d1", format: "pdf", sha256: "corpus-04", extractionStatus: extraction.status, pageTexts: extraction.pageTexts, pageCount: extraction.pageCount };
    const repo = new MemoryPipelineRepository(clock);
    const { job } = await startJob(repo, [document], DEFAULT_HANDLERS);
    await runToEnd(repo, DEFAULT_HANDLERS, depsOf(document), job.id);
    const cleaning = (await repo.listStages(job.id)).find((s) => s.stage === "cleaning");
    expect((cleaning?.output as { text: string }).text).toBe(extraction.extractedText);
  });
  it("06-digitalizado: segue sem texto (OCR é a Fase 3) sem quebrar o pipeline", async () => {
    const extraction = await extractCorpus("06-digitalizado.pdf");
    const document: PipelineDocument = { id: "d2", format: "pdf", sha256: "corpus-06", extractionStatus: extraction.status, pageTexts: extraction.pageTexts, pageCount: extraction.pageCount };
    const repo = new MemoryPipelineRepository(clock);
    const { job } = await startJob(repo, [document], DEFAULT_HANDLERS);
    const outcomes = await runToEnd(repo, DEFAULT_HANDLERS, depsOf(document), job.id);
    expect(outcomes.at(-1)?.kind).toBe("done");
    expect((await repo.listStages(job.id))[0].output).toMatchObject({ status: "no-text" });
  });
});
