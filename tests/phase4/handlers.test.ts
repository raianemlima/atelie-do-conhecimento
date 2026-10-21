import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advanceJob } from "@/lib/pipeline/engine";
import { DEFAULT_HANDLERS, thematicMapHandler } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument, StageRow } from "@/lib/pipeline/types";
import type { SegmentationResult } from "@/lib/segmentation/types";
import { buildThematicMap, contentSegmentIds } from "@/lib/thematic/build";
import { MemoryMapStore } from "@/lib/thematic/memory-store";
import { validateMap } from "@/lib/thematic/operations";
import type { ThematicMap } from "@/lib/thematic/types";
import { CORPUS_DIR } from "../helpers";

const file = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const doc = (id: string, name: string): PipelineDocument => ({ id, title: `Apostila ${id}`, format: "pdf", sha256: `sha-${name}`, extractionStatus: "text", pageTexts: [], pageCount: 1 });

let seq = 0;
async function run(files: Record<string, string>, extra: Partial<PipelineDeps> = {}, repo = new MemoryPipelineRepository(), notebook = `nb-${(seq += 1)}`) {
  const docs = Object.entries(files).map(([id, name]) => doc(id, name));
  const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => file(files[id]), ...extra };
  const { job } = await repo.createJob({ notebookId: notebook, inputHash: jobInputHash(docs, DEFAULT_HANDLERS), stages: planStages(docs, DEFAULT_HANDLERS), maxAttempts: 3 });
  const kinds: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const outcome = await advanceJob(repo, DEFAULT_HANDLERS, deps, job.id);
    kinds.push(outcome.kind);
    if (outcome.kind === "done" || outcome.kind === "failed") break;
  }
  return { repo, job, kinds, stages: await repo.listStages(job.id), notebook };
}
const stageOutput = <T,>(stages: StageRow[], stage: string, subject: string | null) => stages.find((s) => s.stage === stage && s.subjectId === subject)?.output as unknown as T;

describe("estágios de segmentação e mapa temático no pipeline", () => {
  it("plano: extração, limpeza e segmentação por documento, depois um único mapa do caderno, em ordem", () => {
    const plan = planStages([{ id: "a" }, { id: "b" }], DEFAULT_HANDLERS);
    expect(plan.map((p) => `${p.stage}:${p.subjectId ?? "caderno"}`)).toEqual(["extraction:a", "extraction:b", "cleaning:a", "cleaning:b", "segmentation:a", "segmentation:b", "thematic_map:caderno", "citation_registry:caderno"]);
  });
  it("duas apostilas: o mapa do pipeline é o mesmo do construtor e fica salvo como versão 1 (rascunho, automática)", async () => {
    const store = new MemoryMapStore();
    const { kinds, stages, job } = await run({ a: "14a-apostila-a.pdf", b: "14b-apostila-b.pdf" }, { mapStore: store, discipline: "Direito Administrativo" });
    expect(kinds.at(-1)).toBe("done");
    const output = stageOutput<{ version: number; map: ThematicMap }>(stages, "thematic_map", null);
    expect(output.version).toBe(1);
    expect(output.map.discipline).toBe("Direito Administrativo");
    expect(output.map.documents).toEqual([{ id: "a", title: "Apostila a" }, { id: "b", title: "Apostila b" }]);
    const segmentations = ["a", "b"].map((id) => stageOutput<SegmentationResult>(stages, "segmentation", id));
    expect(output.map).toEqual(buildThematicMap({ discipline: "Direito Administrativo", documents: output.map.documents, segmentations }));
    expect(validateMap(output.map, contentSegmentIds(segmentations))).toEqual([]);
    expect(output.map.nodes.map((n) => n.title)).toContain("Responsabilidade civil extracontratual do Estado");
    const saved = await store.latest(job.notebookId);
    expect(saved).toMatchObject({ version: 1, origin: "auto", status: "draft", sourceJobId: job.id, discipline: "Direito Administrativo" });
  });
  it("sem disciplina informada, usa 'Geral'", async () => {
    const { stages } = await run({ a: "14a-apostila-a.pdf" });
    expect(stageOutput<{ map: ThematicMap }>(stages, "thematic_map", null).map.discipline).toBe("Geral");
  });
  it("a etapa do mapa NÃO usa cache: cada caderno recebe a sua versão mesmo com as mesmas fontes", async () => {
    const store = new MemoryMapStore();
    const repo = new MemoryPipelineRepository();
    const first = await run({ a: "14a-apostila-a.pdf" }, { mapStore: store }, repo, "nb-x");
    const second = await run({ a: "14a-apostila-a.pdf" }, { mapStore: store }, repo, "nb-y");
    expect(first.stages.find((s) => s.stage === "thematic_map")?.cacheHit).toBe(false);
    expect(second.stages.find((s) => s.stage === "thematic_map")?.cacheHit).toBe(false);
    expect(await store.latest("nb-x")).not.toBeNull();
    expect(await store.latest("nb-y")).not.toBeNull();
    expect(second.stages.filter((s) => s.stage !== "thematic_map").every((s) => s.cacheHit)).toBe(true);
  });
  it("reexecutar a etapa do mapa para o MESMO job não cria versão duplicada (retomada após queda)", async () => {
    const store = new MemoryMapStore();
    const { stages, job } = await run({ a: "14a-apostila-a.pdf" }, { mapStore: store });
    const row = stages.find((s) => s.stage === "thematic_map") as StageRow;
    const deps: PipelineDeps = { loadDocument: async (id) => doc(id, "14a-apostila-a.pdf"), mapStore: store };
    await thematicMapHandler.run({ job, stage: row, stages, deps });
    await thematicMapHandler.run({ job, stage: row, stages, deps });
    expect(await store.list(job.notebookId)).toHaveLength(1);
  });
  it("mudança de opção que não altera o texto reaproveita a segmentação em cache (chave pelo conteúdo)", async () => {
    const repo = new MemoryPipelineRepository();
    await run({ a: "14a-apostila-a.pdf" }, {}, repo, "nb-1");
    const second = await run({ a: "14a-apostila-a.pdf" }, { keepProfessors: true }, repo, "nb-2");
    expect(second.stages.find((s) => s.stage === "cleaning")?.cacheHit).toBe(false);
    expect(second.stages.find((s) => s.stage === "segmentation")?.cacheHit).toBe(true);
  });
  it("documento sem estrutura entra no mapa como tema a revisar, com aviso", async () => {
    const { stages } = await run({ a: "14a-apostila-a.pdf", z: "16-sem-estrutura.pdf" });
    const map = stageOutput<{ map: ThematicMap }>(stages, "thematic_map", null).map;
    expect(map.nodes.find((n) => n.documentIds.includes("z"))).toMatchObject({ title: "Apostila z", needsReview: true });
    expect(map.warnings[0]).toMatch(/Apostila z.*não tem títulos reconhecíveis/);
  });
  it("PDF digitalizado (sem texto) não quebra o mapa: gera aviso e segue", async () => {
    const { kinds, stages } = await run({ a: "14a-apostila-a.pdf", s: "06-digitalizado.pdf" });
    expect(kinds.at(-1)).toBe("done");
    expect(stageOutput<{ map: ThematicMap }>(stages, "thematic_map", null).map.warnings.some((w) => /Apostila s.*sem conteúdo|Apostila s.*não tem conteúdo/.test(w))).toBe(true);
  });
});
