import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateMap } from "@/lib/thematic/operations";
import type { ThematicMap } from "@/lib/thematic/types";
import { CORPUS_DIR } from "../helpers";
import { FakeDb, makeFakeSupabase } from "../phase2/fake-supabase";

const requireUser = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));

import { POST as createJob } from "@/app/api/jobs/route";
import { POST as advance } from "@/app/api/jobs/[id]/advance/route";
import { GET as getMap } from "@/app/api/notebooks/[id]/map/route";
import { POST as editMap } from "@/app/api/notebooks/[id]/map/edit/route";
import { POST as confirmMap } from "@/app/api/notebooks/[id]/map/confirm/route";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const DOCS = { A: "d1111111-1111-4111-8111-111111111111", B: "d2222222-2222-4222-8222-222222222222" };
let db: FakeDb;

const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seed(id: string, file: string, title: string) {
  const path = `${USER}/${id}/original.pdf`;
  db.tables.documents.push({ id, owner_id: USER, title, format: "pdf", sha256: `sha-${file}`, extraction_status: "text", page_texts: [], page_count: 1, storage_path: path });
  db.objects.set(path, new Uint8Array(readFileSync(join(CORPUS_DIR, file))));
}

async function processNotebook(body: Record<string, unknown>) {
  const created = await (await createJob(post({ name: "Caderno de Direito", documentIds: [DOCS.A, DOCS.B], ...body }))).json();
  for (let i = 0; i < 40; i += 1) {
    const step = await (await advance(new Request("http://x", { method: "POST" }), ctx(created.view.job.id))).json();
    if (step.outcome.kind === "done" || step.outcome.kind === "failed") return { notebookId: created.view.job.notebookId as string, outcome: step.outcome.kind as string, jobId: created.view.job.id as string };
  }
  throw new Error("não terminou");
}

beforeEach(() => {
  db = new FakeDb();
  vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireUser.mockReset();
  requireUser.mockResolvedValue({ supabase: makeFakeSupabase(db, USER), user: { id: USER } });
  seed(DOCS.A, "14a-apostila-a.pdf", "Apostila A");
  seed(DOCS.B, "14b-apostila-b.pdf", "Apostila B");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("fluxo completo pela API: processar, revisar e confirmar o mapa", () => {
  it("o job gera o mapa (v1, automático) com a disciplina e os títulos dos documentos", async () => {
    const { notebookId, outcome } = await processNotebook({ discipline: "Direito Administrativo" });
    expect(outcome).toBe("done");
    expect(db.tables.notebooks[0].discipline).toBe("Direito Administrativo");
    const body = await (await getMap(new Request("http://x"), ctx(notebookId))).json();
    expect(body.latest).toMatchObject({ version: 1, origin: "auto", status: "draft", discipline: "Direito Administrativo" });
    expect(body.latest.map.documents).toEqual([{ id: DOCS.A, title: "Apostila A" }, { id: DOCS.B, title: "Apostila B" }]);
    expect(body.latest.map.nodes.map((n: { title: string }) => n.title)).toEqual(["Responsabilidade civil extracontratual do Estado", "Teoria do risco administrativo", "Responsabilidade por omissao", "Prescricao", "IMPROBIDADE ADMINISTRATIVA"]);
    expect(body.versions).toHaveLength(1);
  });
  it("sem disciplina informada, a disciplina é o nome do caderno", async () => {
    const { notebookId } = await processNotebook({});
    const { latest } = await (await getMap(new Request("http://x"), ctx(notebookId))).json();
    expect(latest.map.discipline).toBe("Caderno de Direito");
  });
  it("editar cria a v2 e preserva a v1; a cobertura continua completa; confirmar a v2 desconfirma a anterior", async () => {
    const { notebookId } = await processNotebook({ discipline: "Direito Administrativo" });
    const v1: { latest: { map: ThematicMap } } = await (await getMap(new Request("http://x"), ctx(notebookId))).json();
    const expected = v1.latest.map.nodes.flatMap((n) => n.coverage.map((c) => c.segmentId));
    const omission = v1.latest.map.nodes.find((n) => n.title === "Responsabilidade por omissao")!;
    const prescription = v1.latest.map.nodes.find((n) => n.title === "Prescricao")!;
    const edit = await editMap(post({ baseVersion: 1, operations: [{ op: "merge", targetId: omission.id, sourceId: prescription.id }, { op: "rename", nodeId: omission.id, title: "Omissão e prescrição" }] }), ctx(notebookId));
    expect(edit.status).toBe(201);
    const v2 = await edit.json();
    expect(v2.latest).toMatchObject({ version: 2, baseVersion: 1, origin: "edited" });
    expect(v2.latest.changeLog).toHaveLength(2);
    expect(validateMap(v2.latest.map, expected)).toEqual([]);
    const stored = db.tables.thematic_maps.find((row) => row.version === 1)!;
    expect((stored.map as ThematicMap).nodes.some((n) => n.title === "Prescricao")).toBe(true);
    await confirmMap(post({ version: 1 }), ctx(notebookId));
    const confirmed = await (await confirmMap(post({ version: 2 }), ctx(notebookId))).json();
    expect(confirmed.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[2, "confirmed"], [1, "draft"]].sort((a, b) => (a[0] as number) - (b[0] as number)).reverse());
  });
  it("outro usuário não enxerga nem edita o mapa", async () => {
    const { notebookId } = await processNotebook({});
    requireUser.mockResolvedValue({ supabase: makeFakeSupabase(db, OTHER), user: { id: OTHER } });
    expect((await getMap(new Request("http://x"), ctx(notebookId))).status).toBe(404);
    expect((await editMap(post({ baseVersion: 1, operations: [{ op: "unignore", nodeId: "x" }] }), ctx(notebookId))).status).toBe(404);
    expect((await confirmMap(post({ version: 1 }), ctx(notebookId))).status).toBe(404);
  });
  it("disciplina longa demais: 400 e nenhum caderno criado", async () => {
    const response = await createJob(post({ name: "x", discipline: "d".repeat(201), documentIds: [DOCS.A] }));
    expect(response.status).toBe(400);
    expect(db.tables.notebooks).toHaveLength(0);
  });
  it("conteúdo dos documentos não aparece na resposta do mapa (só títulos, fontes, páginas e totais)", async () => {
    const { notebookId } = await processNotebook({});
    const raw = JSON.stringify(await (await getMap(new Request("http://x"), ctx(notebookId))).json());
    expect(raw).not.toContain("dever de reparar os danos");
    expect(raw).not.toContain("excludentes");
  });
});
