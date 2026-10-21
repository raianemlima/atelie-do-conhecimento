import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/types";
import { buildExportDocument } from "@/lib/export/build";
import { exportAs } from "@/lib/export";
import { partFromStages, type ExportPartData } from "@/lib/export/from-stages";
import { advanceJob } from "@/lib/pipeline/engine";
import { AI_HANDLERS } from "@/lib/pipeline/handlers";
import { MemoryPipelineRepository } from "@/lib/pipeline/memory-repository";
import { jobInputHash, planStages } from "@/lib/pipeline/plan";
import type { PipelineDeps, PipelineDocument, StageRow } from "@/lib/pipeline/types";
import { CORPUS_DIR } from "../helpers";

const FILES: Record<string, string> = { a: "14a-apostila-a.pdf", b: "14b-apostila-b.pdf" };
const docs: PipelineDocument[] = Object.entries(FILES).map(([id, name]) => ({ id, title: `Apostila ${id}`, format: "pdf", sha256: `sha-${name}`, extractionStatus: "text", pageTexts: [], pageCount: 1 }));

const ai = (noisy = false): AiProvider => {
  let n = 0;
  return { id: "mock", async generate() {
    n += 1;
    const paragraph = noisy ? "Texto completo que cita o arquivo apostila-final.pdf em sua redação." : `Texto didático limpo e completo número ${n} sobre o tema estudado, redigido de forma integrada.`;
    return { text: JSON.stringify({ title: "T", blocks: [{ type: "development", heading: "Desenvolvimento", paragraphs: [paragraph] }], citationsUsed: [], glossary: [{ term: `Termo ${n}`, definition: `Definição do termo ${n} apoiada nos trechos.` }] }), stopReason: "end" as const, tokensIn: 10, tokensOut: 10, costUsd: 0.001 };
  } };
};

async function pipeline(provider: AiProvider): Promise<StageRow[]> {
  const repo = new MemoryPipelineRepository();
  const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => new Uint8Array(readFileSync(join(CORPUS_DIR, FILES[id]))), ai: { provider, budget: { maxCostUsd: 10, maxTokensPerCall: 1000 } } };
  const { job } = await repo.createJob({ notebookId: `nb-${Math.random()}`, inputHash: jobInputHash(docs, AI_HANDLERS), stages: planStages(docs, AI_HANDLERS), maxAttempts: 3 });
  for (let i = 0; i < 80; i += 1) { const o = await advanceJob(repo, AI_HANDLERS, deps, job.id); if (o.kind === "done" || o.kind === "failed") break; }
  return repo.listStages(job.id);
}

describe("do pipeline à exportação", () => {
  it("apostila verificada vira PDF, DOCX e Markdown com os temas do mapa e o glossário gerado", async () => {
    const part = partFromStages(await pipeline(ai()));
    expect(part).not.toBeNull();
    const doc = buildExportDocument({ title: "Direito Administrativo", parts: [part as ExportPartData] });
    expect(doc.stats.chapters).toBeGreaterThan(0);
    expect(doc.stats.glossaryTerms).toBeGreaterThan(0);
    expect(doc.warnings).toEqual([]);
    for (const format of ["pdf", "docx", "md"] as const) {
      const file = await exportAs(doc, format, new Date("2026-10-21T12:00:00Z"));
      expect(file.bytes.length).toBeGreaterThan(500);
      expect(file.fileName).toBe(`direito-administrativo.${format}`);
    }
  });
  it("apostila reprovada na verificação NÃO é exportável", async () => {
    expect(partFromStages(await pipeline(ai(true)))).toBeNull();
  });
  it("sem IA configurada (etapa pulada) não há o que exportar", async () => {
    const repo = new MemoryPipelineRepository();
    const deps: PipelineDeps = { loadDocument: async (id) => docs.find((d) => d.id === id) ?? null, loadOriginal: async (id) => new Uint8Array(readFileSync(join(CORPUS_DIR, FILES[id]))) };
    const { job } = await repo.createJob({ notebookId: "nb-x", inputHash: jobInputHash(docs, AI_HANDLERS), stages: planStages(docs, AI_HANDLERS), maxAttempts: 3 });
    for (let i = 0; i < 80; i += 1) { const o = await advanceJob(repo, AI_HANDLERS, deps, job.id); if (o.kind === "done" || o.kind === "failed") break; }
    expect(partFromStages(await repo.listStages(job.id))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
const requireUser = vi.fn();
const loadLatestPart = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/server/export", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/export")>()), loadLatestPart: (...args: unknown[]) => loadLatestPart(...args) }));

import { GET as exportNotebook } from "@/app/api/notebooks/[id]/export/route";
import { GET as exportMany } from "@/app/api/export/route";

const NB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = (id = NB) => ({ params: Promise.resolve({ id }) });

describe("rotas de exportação", () => {
  let part: ExportPartData & { name: string };
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireUser.mockReset(); loadLatestPart.mockReset();
    requireUser.mockResolvedValue({ supabase: {}, user: { id: "u" } });
    part = { ...(partFromStages(await pipeline(ai())) as ExportPartData), name: "Caderno de Teste" };
    loadLatestPart.mockResolvedValue(part);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([["pdf", "application/pdf", "%PDF-"], ["docx", "wordprocessingml.document", "PK"], ["md", "text/markdown", "# Caderno de Teste"]])("GET ?format=%s devolve o arquivo com tipo e nome certos", async (format, type, start) => {
    const response = await exportNotebook(new Request(`http://x/api?format=${format}`), ctx());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(type);
    expect(response.headers.get("Content-Disposition")).toContain(`caderno-de-teste.${format}`);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(new TextDecoder("latin1").decode(new Uint8Array(await response.arrayBuffer()).slice(0, 40))).toContain(start);
  });
  it("erros: flag desligada 404, id inválido 400, formato inválido 400, sem apostila 404, sem sessão 401", async () => {
    expect((await exportNotebook(new Request("http://x/api?format=pdf"), ctx("nao-e-uuid"))).status).toBe(400);
    expect((await exportNotebook(new Request("http://x/api?format=exe"), ctx())).status).toBe(400);
    loadLatestPart.mockResolvedValue(null);
    const none = await exportNotebook(new Request("http://x/api?format=pdf"), ctx());
    expect(none.status).toBe(404);
    expect((await none.json()).error.message).toContain("apostila verificada");
    const { ApiError } = await import("@/lib/server/http");
    requireUser.mockRejectedValue(new ApiError(401, "unauthenticated", "Sua sessão expirou."));
    expect((await exportNotebook(new Request("http://x/api?format=pdf"), ctx())).status).toBe(401);
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "false");
    expect((await exportNotebook(new Request("http://x/api?format=pdf"), ctx())).status).toBe(404);
  });
  it("vários cadernos: junta as apostilas numa só (uma parte por caderno) e valida a lista", async () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const response = await exportMany(new Request(`http://x/api/export?notebooks=${NB},${other}&format=md`));
    expect(response.status).toBe(200);
    expect(loadLatestPart).toHaveBeenCalledTimes(2);
    const text = await response.text();
    expect(text.match(/^## /gm)?.length).toBeGreaterThanOrEqual(2);
    expect((await exportMany(new Request("http://x/api/export?format=md"))).status).toBe(400);
    expect((await exportMany(new Request("http://x/api/export?notebooks=abc&format=md"))).status).toBe(400);
  });
});
