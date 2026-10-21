import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateDraftCost } from "@/lib/ai/estimate";
import type { AiProvider, AiResponse } from "@/lib/ai/types";
import type { DraftInput } from "@/lib/drafting/types";
import { diffVersions, MemoryDraftStore, planIncremental, themeFingerprint, type DraftVersion } from "@/lib/drafting/versions";
import { advanceJob } from "@/lib/pipeline/engine";
import { AI_HANDLERS } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument, StageRow } from "@/lib/pipeline/types";
import { CORPUS_DIR } from "../helpers";

const input = (id: string, text: string): DraftInput => ({ themeId: id, title: `Tema ${id}`, path: ["D"], sources: [{ segmentId: `s-${id}`, text }], citations: [], forbiddenTerms: [] });
const PRICING = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };

describe("estimativa de custo", () => {
  it("cresce com temas e texto, é determinística e zera sem temas", () => {
    const small = estimateDraftCost([input("a", "x".repeat(500))], PRICING, 1000);
    const big = estimateDraftCost([input("a", "x".repeat(500)), input("b", "y".repeat(5000))], PRICING, 1000);
    expect(big.costUsd).toBeGreaterThan(small.costUsd);
    expect(big.themes).toBe(2);
    expect(estimateDraftCost([input("a", "x".repeat(500))], PRICING, 1000)).toEqual(small);
    expect(estimateDraftCost([], PRICING, 1000)).toMatchObject({ themes: 0, costUsd: 0 });
    expect(small.approximate).toBe(true);
  });
  it("saída estimada respeita o limite por chamada", () => {
    expect(estimateDraftCost([input("a", "x")], PRICING, 200).tokensOut).toBe(200);
  });
});

describe("plano incremental e versões", () => {
  const draft = (id: string, text: string, fp = themeFingerprint(input(id, text))) => ({ fingerprint: fp, title: `Tema ${id}`, result: { themeId: id, title: `Tema ${id}`, draft: { title: id, blocks: [{ type: "intro" as const, heading: "h", paragraphs: [text] }], citationsUsed: [] }, removedCitations: [], error: null, tokensIn: 1, tokensOut: 1, costUsd: 0 } });
  const store = () => new MemoryDraftStore(() => new Date("2026-01-01T00:00:00Z"));

  it("reusa o que não mudou, refaz o que mudou e aponta o que saiu", async () => {
    const s = store();
    const v1 = await s.saveGenerated({ notebookId: "n", jobId: "j1", order: ["a", "b", "c"], themes: { a: draft("a", "A"), b: draft("b", "B"), c: draft("c", "C") } });
    const plan = planIncremental([input("a", "A"), input("b", "B novo"), input("d", "D")], v1);
    expect(plan.reuse).toEqual(["a"]);
    expect(plan.redo.map((i) => i.themeId)).toEqual(["b", "d"]);
    expect(plan.removed).toEqual(["c"]);
    expect(planIncremental([input("a", "A")], null).redo).toHaveLength(1);
  });
  it("salvar o mesmo job duas vezes não cria versão nova (idempotente)", async () => {
    const s = store();
    const a = await s.saveGenerated({ notebookId: "n", jobId: "j1", order: ["a"], themes: { a: draft("a", "A") } });
    const b = await s.saveGenerated({ notebookId: "n", jobId: "j1", order: ["a"], themes: { a: draft("a", "OUTRO") } });
    expect(b.version).toBe(a.version);
    expect(s.versions).toHaveLength(1);
  });
  it("compara versões e restaura criando uma NOVA versão, sem apagar nada", async () => {
    const s = store();
    const v1 = await s.saveGenerated({ notebookId: "n", jobId: "j1", order: ["a", "b"], themes: { a: draft("a", "A"), b: draft("b", "B") } });
    const v2 = await s.saveGenerated({ notebookId: "n", jobId: "j2", order: ["a", "b2"], themes: { a: draft("a", "A mudou"), b2: draft("b2", "B2") } });
    expect(diffVersions(v1 as DraftVersion, v2 as DraftVersion)).toEqual({ added: ["b2"], removed: ["b"], changed: ["a"], unchanged: [] });
    const v3 = await s.restore("n", 1);
    expect(v3).toMatchObject({ version: 3, baseVersion: 1, origin: "restored" });
    expect(diffVersions(v1 as DraftVersion, v3 as DraftVersion)).toEqual({ added: [], removed: [], changed: [], unchanged: ["a", "b"] });
    expect(s.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(await s.restore("n", 99)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
const FILES: Record<string, string> = { a: "14a-apostila-a.pdf", b: "14b-apostila-b.pdf" };
const docOf = (id: string): PipelineDocument => ({ id, title: `Apostila ${id}`, format: "pdf", sha256: `sha-${FILES[id]}`, extractionStatus: "text", pageTexts: [], pageCount: 1 });

class CountingAi implements AiProvider {
  id = "mock";
  calls = 0;
  constructor(private readonly failOnCall?: number) {}
  async generate(): Promise<AiResponse> {
    this.calls += 1;
    if (this.calls === this.failOnCall) throw new Error("falha de rede simulada");
    return { text: JSON.stringify({ title: "T", blocks: [{ type: "intro", heading: "Introdução", paragraphs: [`Texto didático limpo e completo da chamada ${this.calls} sobre o tema.`] }], citationsUsed: [] }), stopReason: "end", tokensIn: 100, tokensOut: 50, costUsd: 0.01 };
  }
}

async function run(ids: string[], options: { ai: CountingAi; store: MemoryDraftStore; notebook: string; maxCostUsd?: number; pricing?: typeof PRICING }) {
  const repo = new MemoryPipelineRepository();
  const docs = ids.map(docOf);
  const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => new Uint8Array(readFileSync(join(CORPUS_DIR, FILES[id]))), draftStore: options.store, ai: { provider: options.ai, budget: { maxCostUsd: options.maxCostUsd ?? 10, maxTokensPerCall: 1000, pricing: options.pricing } } };
  const { job } = await repo.createJob({ notebookId: options.notebook, inputHash: jobInputHash(docs, AI_HANDLERS), stages: planStages(docs, AI_HANDLERS), maxAttempts: 3 });
  let now = Date.now();
  let last = "";
  for (let i = 0; i < 120; i += 1) {
    const outcome = await advanceJob(repo, AI_HANDLERS, deps, job.id, { now: () => new Date(now) });
    last = outcome.kind;
    if (outcome.kind === "waiting") now += 120_000;
    if (outcome.kind === "done" || outcome.kind === "failed") break;
  }
  return { last, stages: await repo.listStages(job.id) };
}
const drafting = (stages: StageRow[]) => stages.find((s) => s.stage === "drafting")!;
type DraftingOut = { version: number | null; reused: number; redrafted: number; themes: unknown[] };

describe("caderno incremental no pipeline (IA simulada)", () => {
  it("primeira geração cria a versão 1; repetir sem mudança NÃO chama a IA", async () => {
    const store = new MemoryDraftStore();
    const ai = new CountingAi();
    const first = await run(["a"], { ai, store, notebook: "nb" });
    const out1 = drafting(first.stages).output as unknown as DraftingOut;
    expect(first.last).toBe("done");
    expect(out1.version).toBe(1);
    expect(ai.calls).toBe(out1.themes.length);
    const again = await run(["a"], { ai, store, notebook: "nb" });
    const out2 = drafting(again.stages).output as unknown as DraftingOut;
    expect(ai.calls).toBe(out1.themes.length);
    expect(out2).toMatchObject({ redrafted: 0, reused: out1.themes.length });
  });
  it("acrescentar um PDF refaz só os temas afetados e cria a versão 2 com base na 1", async () => {
    const store = new MemoryDraftStore();
    const ai = new CountingAi();
    await run(["a"], { ai, store, notebook: "nb" });
    const before = ai.calls;
    const second = await run(["a", "b"], { ai, store, notebook: "nb" });
    const out = drafting(second.stages).output as unknown as DraftingOut;
    expect(second.last).toBe("done");
    expect(out.version).toBe(2);
    expect(store.versions[1].baseVersion).toBe(1);
    expect(out.redrafted).toBeGreaterThan(0);
    expect(out.reused).toBeGreaterThan(0);
    expect(ai.calls - before).toBe(out.redrafted);
    expect(out.redrafted + out.reused).toBe(out.themes.length);
  });
  it("falha da IA no meio: a retomada não paga de novo pelos temas já prontos", async () => {
    const store = new MemoryDraftStore();
    const ai = new CountingAi(2);
    const result = await run(["a"], { ai, store, notebook: "nb" });
    const out = drafting(result.stages).output as unknown as DraftingOut;
    expect(result.last).toBe("done");
    expect(drafting(result.stages).attempts).toBeGreaterThan(1);
    expect(ai.calls).toBe(out.themes.length + 1);
  });
  it("estimativa acima do teto: recusa ANTES de qualquer chamada", async () => {
    const ai = new CountingAi();
    const result = await run(["a"], { ai, store: new MemoryDraftStore(), notebook: "nb", maxCostUsd: 0.000001, pricing: PRICING });
    expect(result.last).toBe("failed");
    expect(drafting(result.stages).error).toContain("estimativa de custo");
    expect(ai.calls).toBe(0);
  });
  it("estimativa dentro do teto roda normalmente", async () => {
    const ai = new CountingAi();
    const result = await run(["a"], { ai, store: new MemoryDraftStore(), notebook: "nb", maxCostUsd: 10, pricing: PRICING });
    expect(result.last).toBe("done");
    expect(ai.calls).toBeGreaterThan(0);
  });
});
