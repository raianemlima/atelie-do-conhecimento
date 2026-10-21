import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest, AiResponse } from "@/lib/ai/types";
import type { CitationRegistry } from "@/lib/citations/types";
import type { ThemeDraftResult } from "@/lib/drafting/types";
import { advanceJob } from "@/lib/pipeline/engine";
import { AI_HANDLERS } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument, StageRow } from "@/lib/pipeline/types";
import type { SegmentationResult } from "@/lib/segmentation/types";
import type { ThematicMap } from "@/lib/thematic/types";
import { MIN_SCORE, removeUnconfirmed, verifyDrafts } from "@/lib/verification/verify";
import { CORPUS_DIR } from "../helpers";

const files: Record<string, string> = { a: "14a-apostila-a.pdf", b: "14b-apostila-b.pdf" };
const docs: PipelineDocument[] = Object.entries(files).map(([id, name]) => ({ id, title: `Apostila ${id}`, format: "pdf", sha256: `sha-${name}`, extractionStatus: "text", pageTexts: [], pageCount: 1 }));
const ok = (paragraph: string): AiResponse => ({ text: JSON.stringify({ title: "Tema", blocks: [{ type: "development", heading: "Desenvolvimento", paragraphs: [paragraph] }], citationsUsed: [] }), stopReason: "end", tokensIn: 10, tokensOut: 10, costUsd: 0.001 });
const provider = (make: (request: AiRequest, n: number) => string): AiProvider => { let n = 0; return { id: "mock", async generate(request) { n += 1; return ok(make(request, n)); } }; };

async function pipeline(ai: AiProvider) {
  const repo = new MemoryPipelineRepository();
  const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => new Uint8Array(readFileSync(join(CORPUS_DIR, files[id]))), ai: { provider: ai, budget: { maxCostUsd: 10, maxTokensPerCall: 1000 } } };
  const { job } = await repo.createJob({ notebookId: `nb-${Math.random()}`, inputHash: jobInputHash(docs, AI_HANDLERS), stages: planStages(docs, AI_HANDLERS), maxAttempts: 3 });
  let last = "";
  for (let i = 0; i < 80; i += 1) { const outcome = await advanceJob(repo, AI_HANDLERS, deps, job.id); last = outcome.kind; if (outcome.kind === "done" || outcome.kind === "failed") break; }
  return { last, stages: await repo.listStages(job.id) };
}
const out = <T,>(stages: StageRow[], stage: string, subject: string | null = null) => stages.find((s) => s.stage === stage && s.subjectId === subject)?.output as unknown as T;

let map: ThematicMap, registry: CitationRegistry, segmentations: SegmentationResult[], drafts: ThemeDraftResult[];
const clean = () => verifyDrafts({ drafts, map, registry, segmentations });
const withParagraph = (text: string): ThemeDraftResult[] => drafts.map((d, i) => (i === 0 && d.draft ? { ...d, draft: { ...d.draft, blocks: [...d.draft.blocks, { type: "attention", heading: "Atenção", paragraphs: [text] }] } } : d));

beforeAll(async () => {
  const { stages } = await pipeline(provider((_r, n) => `Texto didático limpo e completo número ${n} sobre o tema estudado, redigido de forma integrada.`));
  map = out<{ map: ThematicMap }>(stages, "thematic_map").map;
  registry = out<CitationRegistry>(stages, "citation_registry");
  segmentations = ["a", "b"].map((id) => out<SegmentationResult>(stages, "segmentation", id));
  drafts = (out<{ themes: ThemeDraftResult[] }>(stages, "drafting")).themes;
});

describe("verificador", () => {
  it("saída limpa, completa e fiel passa com nota máxima", () => {
    const { report } = clean();
    expect(report.findings.filter((f) => f.severity === "bloqueante")).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(report.unlinkedSegments).toEqual([]);
    expect(map.nodes.filter((n) => !n.ignored && n.coverage.length > 0).length).toBeGreaterThan(0);
  });
  it.each([
    ["nome de arquivo", "Veja o conteúdo em apostila-direito.pdf para mais detalhes."],
    ["URL", "Acesse https://exemplo.com/curso para o material."],
    ["número de página", "Isso aparece na página 12 do material estudado."],
    ["fala da IA", "Claro! Aqui está o resumo pedido do tema estudado."],
    ["e-mail", "Envie dúvidas para aluno@curso.com.br sobre o tema estudado."],
  ])("detecta ruído: %s", (label, text) => {
    const { report } = verifyDrafts({ drafts: withParagraph(text), map, registry, segmentations });
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.dimension === "limpeza" && f.severity === "bloqueante")).toBe(true);
    expect(label).toBeTruthy();
  });
  it("detecta bloco truncado e parágrafo duplicado", () => {
    expect(verifyDrafts({ drafts: withParagraph("O prazo para recorrer é de quinze dias conforme o art."), map, registry, segmentations }).report.findings.some((f) => f.dimension === "integridade" && f.severity === "bloqueante")).toBe(true);
    const dup = "Este parágrafo repetido possui bastante texto para ser reconhecido como duplicado.";
    const twice = withParagraph(dup).map((d, i) => (i === 1 && d.draft ? { ...d, draft: { ...d.draft, blocks: [...d.draft.blocks, { type: "attention" as const, heading: "Atenção", paragraphs: [dup] }] } } : d));
    expect(verifyDrafts({ drafts: twice, map, registry, segmentations }).report.findings.some((f) => f.message.includes("repetido"))).toBe(true);
  });
  it("tema do mapa sem redação reprova na cobertura", () => {
    const { report } = verifyDrafts({ drafts: drafts.slice(1), map, registry, segmentations });
    expect(report.passed).toBe(false);
    expect(report.findings.some((f) => f.dimension === "cobertura" && f.severity === "bloqueante")).toBe(true);
    expect(report.unlinkedSegments.length).toBeGreaterThan(0);
  });
  it("citação não confirmada é REMOVIDA do texto e reportada", () => {
    const text = "A Defensoria atua na tutela coletiva. Aplica-se a Súmula 999 do STJ ao caso. O prazo segue a regra geral.";
    const { drafts: fixed, report } = verifyDrafts({ drafts: withParagraph(text), map, registry, segmentations });
    const body = JSON.stringify(fixed[0].draft);
    expect(body).not.toContain("Súmula 999");
    expect(body).toContain("A Defensoria atua na tutela coletiva.");
    expect(body).toContain("O prazo segue a regra geral.");
    expect(report.removedCitations).toEqual([expect.objectContaining({ label: expect.stringContaining("999") })]);
    expect(removeUnconfirmed(fixed[0].draft!, registry).removed).toEqual([]);
  });
  it("relatório lista temas de fonte única e é determinístico", () => {
    expect(clean().report).toEqual(clean().report);
    expect(clean().report.singleSourceThemes.length).toBe(map.nodes.filter((n) => !n.ignored && n.singleSource).length);
  });
});

describe("etapa de verificação no pipeline", () => {
  it("saída limpa: o job conclui e guarda o relatório", async () => {
    const { last, stages } = await pipeline(provider((_r, n) => `Texto didático limpo e completo número ${n} sobre o tema estudado, redigido de forma integrada.`));
    expect(last).toBe("done");
    expect(out<{ report: { passed: boolean } }>(stages, "verification").report.passed).toBe(true);
  });
  it("saída com ruído: o job NÃO é concluído e a mensagem diz o motivo", async () => {
    const { last, stages } = await pipeline(provider(() => "Texto completo que cita o arquivo apostila-final.pdf em sua redação."));
    expect(last).toBe("failed");
    expect(stages.find((s) => s.stage === "verification")?.error).toContain("Qualidade abaixo do mínimo");
  });
});

