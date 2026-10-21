import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiProvider, AiRequest, AiResponse } from "@/lib/ai/types";
import { checkDraft, draftTheme } from "@/lib/drafting/draft";
import { DraftValidationError, parseDraft } from "@/lib/drafting/schema";
import type { DraftInput } from "@/lib/drafting/types";
import { advanceJob } from "@/lib/pipeline/engine";
import { AI_HANDLERS } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument } from "@/lib/pipeline/types";
import { CORPUS_DIR } from "../helpers";

const valid = (extra: Record<string, unknown> = {}) => JSON.stringify({ title: "Tema", blocks: [{ type: "intro", heading: "Introdução", paragraphs: ["Texto limpo."] }], citationsUsed: [], ...extra });
const response = (text: string, over: Partial<AiResponse> = {}): AiResponse => ({ text, stopReason: "end", tokensIn: 100, tokensOut: 50, costUsd: 0.01, ...over });

class ScriptedAi implements AiProvider {
  id = "mock";
  requests: AiRequest[] = [];
  constructor(private readonly replies: (AiResponse | ((request: AiRequest) => AiResponse))[]) {}
  async generate(request: AiRequest) {
    this.requests.push(request);
    const reply = this.replies[Math.min(this.requests.length - 1, this.replies.length - 1)];
    return typeof reply === "function" ? reply(request) : reply;
  }
}

const input: DraftInput = { themeId: "t1", title: "Assistência jurídica", path: ["Direito"], sources: [{ segmentId: "s1", text: "A Defensoria presta assistência jurídica integral (art. 134 da CF/88)." }], citations: [{ key: "law|CF/1988|art:134", label: "CF/1988, art. 134", statements: [] }], forbiddenTerms: ["Apostila A"] };

describe("schema da resposta", () => {
  it("aceita resposta válida, inclusive embrulhada em cerca de código", () => {
    expect(parseDraft("```json\n" + valid() + "\n```").blocks).toHaveLength(1);
  });
  it.each([
    ["JSON inválido", "não é json"],
    ["sem blocos", valid({ blocks: [] })],
    ["tipo desconhecido", valid({ blocks: [{ type: "x", heading: "h", paragraphs: ["a"] }] })],
    ["bloco vazio", valid({ blocks: [{ type: "intro", heading: "h", paragraphs: [" "] }] })],
    ["citationsUsed inválido", valid({ citationsUsed: [1] })],
    ["tabela inválida", valid({ blocks: [{ type: "comparison", heading: "h", paragraphs: [], table: { headers: ["a"], rows: [[1]] } }] })],
  ])("rejeita: %s", (_name, text) => {
    expect(() => parseDraft(text)).toThrow(DraftValidationError);
  });
});

describe("redação de um tema", () => {
  it("aceita texto que usa só citações fornecidas e soma tokens e custo", async () => {
    const ai = new ScriptedAi([response(valid({ blocks: [{ type: "development", heading: "Desenvolvimento", paragraphs: ["Conforme o art. 134 da CF/88, a Defensoria presta assistência."] }], citationsUsed: ["law|CF/1988|art:134"] }))]);
    const result = await draftTheme(ai, input, { maxTokens: 1000 });
    expect(result.error).toBeNull();
    expect(result.draft?.citationsUsed).toEqual(["law|CF/1988|art:134"]);
    expect(result).toMatchObject({ tokensIn: 100, tokensOut: 50, costUsd: 0.01 });
    expect(ai.requests[0].prompt).toContain("CF/1988, art. 134");
  });
  it("recusa citação inventada no texto, tenta de novo com a correção e aceita a segunda resposta", async () => {
    const bad = response(valid({ blocks: [{ type: "development", heading: "D", paragraphs: ["Aplica-se a Súmula 999 do STJ."] }] }));
    const ai = new ScriptedAi([bad, response(valid())]);
    const result = await draftTheme(ai, input, { maxTokens: 1000 });
    expect(result.draft).not.toBeNull();
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[1].prompt).toContain("Súmula 999");
    expect(result.costUsd).toBeCloseTo(0.02);
  });
  it("recusa chave fora da lista em citationsUsed e menção à origem; esgota tentativas com erro", async () => {
    const draft = JSON.parse(valid({ citationsUsed: ["sumula:STJ:1"] }));
    expect(checkDraft(draft, input)).toEqual(["citação fora da lista: sumula:STJ:1"]);
    const leak = JSON.parse(valid({ blocks: [{ type: "intro", heading: "h", paragraphs: ["Segundo a apostila a..."] }] }));
    expect(checkDraft({ ...leak, blocks: [{ ...leak.blocks[0], paragraphs: ["Como diz a Apostila A, ..."] }] }, input)).toContain("menção à origem do material");
    const result = await draftTheme(new ScriptedAi([response(valid({ citationsUsed: ["sumula:STJ:1"] }))]), input, { maxTokens: 1000 });
    expect(result.draft).toBeNull();
    expect(result.error).toContain("recusada");
  });
  it("resposta cortada pelo limite nunca é aceita", async () => {
    const ai = new ScriptedAi([response(valid(), { stopReason: "max_tokens" })]);
    const result = await draftTheme(ai, input, { maxTokens: 10 });
    expect(result.draft).toBeNull();
    expect(result.error).toContain("cortada");
    expect(ai.requests).toHaveLength(2);
  });
});

describe("etapa de redação no pipeline (IA simulada)", () => {
  const files: Record<string, string> = { a: "14a-apostila-a.pdf", b: "14b-apostila-b.pdf" };
  const docs: PipelineDocument[] = Object.entries(files).map(([id, name]) => ({ id, title: `Apostila ${id}`, format: "pdf", sha256: `sha-${name}`, extractionStatus: "text", pageTexts: [], pageCount: 1 }));
  async function run(ai?: PipelineDeps["ai"]) {
    const repo = new MemoryPipelineRepository();
    const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => new Uint8Array(readFileSync(join(CORPUS_DIR, files[id]))), ai };
    const { job } = await repo.createJob({ notebookId: `nb-${Math.random()}`, inputHash: jobInputHash(docs, AI_HANDLERS), stages: planStages(docs, AI_HANDLERS), maxAttempts: 3 });
    let last = "";
    for (let i = 0; i < 60; i += 1) {
      const outcome = await advanceJob(repo, AI_HANDLERS, deps, job.id);
      last = outcome.kind;
      if (outcome.kind === "done" || outcome.kind === "failed") break;
    }
    return { last, stage: (await repo.listStages(job.id)).find((s) => s.stage === "drafting") };
  }
  const echo = (request: AiRequest): AiResponse => response(valid({ title: "Tema redigido", blocks: [{ type: "intro", heading: "Introdução", paragraphs: [`Resumo com ${request.prompt.length} caracteres de contexto.`] }] }));

  it("sem provedor: a etapa é pulada e nenhuma chamada é feita", async () => {
    const { last, stage } = await run();
    expect(last).toBe("done");
    expect(stage?.output).toMatchObject({ skipped: true });
  });
  it("com provedor: uma chamada por tema (nunca a apostila inteira), com custo agregado na etapa", async () => {
    const ai = new ScriptedAi([echo]);
    const { last, stage } = await run({ provider: ai, budget: { maxCostUsd: 10, maxTokensPerCall: 1000 } });
    expect(last).toBe("done");
    const output = stage?.output as unknown as { themes: { title: string }[] };
    expect(output.themes.length).toBeGreaterThan(1);
    expect(ai.requests).toHaveLength(output.themes.length);
    for (const request of ai.requests) expect(request.prompt.length).toBeLessThan(20000);
    expect(stage?.costUsd).toBeCloseTo(0.01 * ai.requests.length);
    expect(stage?.tokensIn).toBe(100 * ai.requests.length);
  });
  it("teto de custo: para antes de estourar e falha com mensagem clara", async () => {
    const ai = new ScriptedAi([echo]);
    const { last, stage } = await run({ provider: ai, budget: { maxCostUsd: 0.015, maxTokensPerCall: 1000 } });
    expect(last).toBe("failed");
    expect(stage?.error).toContain("Teto de custo");
    expect(ai.requests).toHaveLength(2);
  });
});
