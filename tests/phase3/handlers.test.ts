import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findNoise } from "@/lib/cleaning/noise-verifier";
import type { CleaningResult } from "@/lib/cleaning/clean";
import type { DocumentExtraction } from "@/lib/extraction";
import { advanceJob } from "@/lib/pipeline/engine";
import { DEFAULT_HANDLERS, extractionHandlerV2 } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument, StageHandler, StepOutcome } from "@/lib/pipeline/types";
import { CORPUS_DIR } from "../helpers";

const file = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const document = (id: string, sha: string): PipelineDocument => ({ id, format: "pdf", sha256: sha, extractionStatus: "text", pageTexts: ["texto do navegador NÃO confiável"], pageCount: 1 });

function depsFor(files: Record<string, string | null>, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    loadDocument: async (id) => (id in files ? document(id, `sha-${files[id] ?? id}`) : null),
    loadOriginal: async (id) => (files[id] ? file(files[id] as string) : null),
    ...extra,
  };
}

let notebookSeq = 0;
async function run(files: Record<string, string | null>, options: { deps?: Partial<PipelineDeps>; repo?: MemoryPipelineRepository; handlers?: StageHandler[] } = {}) {
  const repo = options.repo ?? new MemoryPipelineRepository();
  const handlers = options.handlers ?? DEFAULT_HANDLERS;
  const deps = depsFor(files, options.deps);
  const docs = Object.keys(files).map((id) => document(id, `sha-${files[id] ?? id}`));
  const { job } = await repo.createJob({ notebookId: `nb-${(notebookSeq += 1)}`, inputHash: jobInputHash(docs, handlers) + (options.deps?.knownTerms ?? []).join(","), stages: planStages(docs, handlers), maxAttempts: 3 });
  const outcomes: StepOutcome[] = [];
  for (let i = 0; i < 30; i += 1) {
    const outcome = await advanceJob(repo, handlers, deps, job.id);
    outcomes.push(outcome);
    if (outcome.kind === "done" || outcome.kind === "failed") break;
  }
  return { repo, job, outcomes, stages: await repo.listStages(job.id) };
}

const outputOf = <T,>(stages: Awaited<ReturnType<typeof run>>["stages"], stage: string, subject: string) => stages.find((s) => s.stage === stage && s.subjectId === subject)?.output as unknown as T;

describe("estágios v2: extração do ORIGINAL no servidor + limpeza determinística", () => {
  it("PDF ruidoso: extrai do arquivo (ignora o texto do navegador) e entrega texto limpo que passa no verificador", async () => {
    const { outcomes, stages } = await run({ d1: "04-ruidoso.pdf" });
    expect(outcomes.map((o) => o.kind)).toEqual(["progressed", "progressed", "done"]);
    const extraction = outputOf<DocumentExtraction>(stages, "extraction", "d1");
    expect(extraction.pageCount).toBe(3);
    expect(JSON.stringify(extraction)).not.toContain("NÃO confiável");
    const cleaning = outputOf<CleaningResult>(stages, "cleaning", "d1");
    expect(cleaning.text).toContain("O Estado prestará assistência jurídica integral e gratuita");
    expect(findNoise(cleaning.text, { knownTerms: ["Curso Exemplo", "Fulano de Tal"] })).toEqual([]);
    expect(cleaning.paragraphs.every((p) => p.pages.length >= 1)).toBe(true);
  });
  it("saídas dos estágios são JSON puro (persistem sem perda)", async () => {
    const { stages } = await run({ d1: "11-notas-de-rodape.pdf" });
    for (const stage of stages) expect(JSON.parse(JSON.stringify(stage.output))).toEqual(stage.output);
  });
  it("vários documentos de formatos de layout diferentes no mesmo job", async () => {
    const { outcomes, stages } = await run({ a: "09-duas-colunas.pdf", b: "10-tabela.pdf", c: "05-citacoes.pdf" });
    expect(outcomes.at(-1)?.kind).toBe("done");
    expect(outputOf<CleaningResult>(stages, "cleaning", "b").paragraphs.map((p) => p.kind)).toEqual(["body", "table", "body"]);
    expect(outputOf<CleaningResult>(stages, "cleaning", "c").text).toContain("Súmula 421 do STJ");
  });
});

describe("falhas de arquivo viram erro claro, sem retentativa inútil", () => {
  it.each([
    ["original ausente", null, /Reenvie o documento/],
    ["PDF corrompido", "07-corrompido.pdf", /corrompido ou incompleto/],
    ["PDF protegido por senha", "08-protegido.pdf", /protegido por senha/],
  ])("%s", async (_name, source, message) => {
    const { outcomes, stages, job, repo } = await run({ d1: source });
    expect(outcomes.at(-1)).toMatchObject({ kind: "failed", error: expect.stringMatching(message) });
    expect(stages[0].attempts).toBe(1);
    expect((await repo.getJob(job.id))?.status).toBe("failed");
  });
});

describe("OCR e páginas digitalizadas", () => {
  it("sem OCR habilitado o job NÃO falha: o aviso segue até a limpeza para o relatório de revisão", async () => {
    const { outcomes, stages } = await run({ d1: "12-misto.pdf" });
    expect(outcomes.at(-1)?.kind).toBe("done");
    const cleaning = outputOf<CleaningResult>(stages, "cleaning", "d1");
    expect(cleaning.warnings).toEqual([expect.stringMatching(/Estas páginas não têm camada de texto/)]);
    expect(cleaning.text).toContain("Primeira pagina com texto");
    expect(cleaning.text).toContain("Terceira pagina com texto");
  });
  it("com OCR habilitado, só a página digitalizada é enviada e o texto entra na limpeza", async () => {
    const recognize = vi.fn(async () => ({ 2: "Página digitalizada reconhecida pelo OCR." }));
    const { stages } = await run({ d1: "12-misto.pdf" }, { deps: { ocr: { id: "ocr-1", recognize } } });
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ pages: [2] }));
    const cleaning = outputOf<CleaningResult>(stages, "cleaning", "d1");
    expect(cleaning.text).toContain("Página digitalizada reconhecida pelo OCR.");
    expect(cleaning.warnings).toEqual([]);
  });
  it("habilitar o OCR invalida o cache da extração (chave inclui o provedor)", async () => {
    const repo = new MemoryPipelineRepository();
    await run({ d1: "12-misto.pdf" }, { repo });
    const cached = (await run({ d1: "12-misto.pdf" }, { repo })).stages;
    expect(cached.every((s) => s.cacheHit)).toBe(true);
    const withOcr = (await run({ d1: "12-misto.pdf" }, { repo, deps: { ocr: { id: "ocr-1", recognize: async () => ({ 2: "texto" }) } } })).stages;
    expect(withOcr.find((s) => s.stage === "extraction")?.cacheHit).toBe(false);
  });
});

describe("cache por hash", () => {
  it("o mesmo arquivo em outro job não é extraído nem limpo de novo", async () => {
    const repo = new MemoryPipelineRepository();
    const spy = vi.spyOn(extractionHandlerV2, "run");
    await run({ d1: "04-ruidoso.pdf" }, { repo });
    const second = await run({ d1: "04-ruidoso.pdf" }, { repo, deps: { knownTerms: [] } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.job.id).toBeDefined();
    spy.mockRestore();
  });
  it("mudar a lista de termos conhecidos invalida só a limpeza", async () => {
    const repo = new MemoryPipelineRepository();
    await run({ d1: "04-ruidoso.pdf" }, { repo });
    const again = (await run({ d1: "04-ruidoso.pdf" }, { repo, deps: { knownTerms: ["Estado"] } })).stages;
    expect(again.find((s) => s.stage === "extraction")?.cacheHit).toBe(true);
    expect(again.find((s) => s.stage === "cleaning")?.cacheHit).toBe(false);
    expect(outputOf<CleaningResult>(again, "cleaning", "d1").removed.some((r) => r.category === "known_term")).toBe(true);
  });
});
