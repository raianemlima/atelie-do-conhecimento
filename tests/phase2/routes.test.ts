import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORPUS_DIR } from "../helpers";
import { ApiError } from "@/lib/server/http";
import { toJobView } from "@/lib/server/pipeline";
import { FakeDb, makeFakeSupabase } from "./fake-supabase";

const requireUser = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));

import { GET as listJobs, POST as createJob } from "@/app/api/jobs/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { POST as advance } from "@/app/api/jobs/[id]/advance/route";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const D1 = "d1111111-1111-4111-8111-111111111111";
const D2 = "d2222222-2222-4222-8222-222222222222";
const SECRET_TEXT = "presta orientação jurídica e defesa dos necessitados";
const PDF_BYTES = new Uint8Array(readFileSync(join(CORPUS_DIR, "01-texto-simples.pdf")));

let db: FakeDb;
const post = (body: unknown) => new Request("http://x/api/jobs", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const login = (userId = USER) => requireUser.mockResolvedValue({ supabase: makeFakeSupabase(db, userId), user: { id: userId } });

function seedDocument(id: string, sha: string, owner = USER, withOriginal = true) {
  const storagePath = `${owner}/${id}/original.pdf`;
  db.tables.documents.push({ id, owner_id: owner, format: "pdf", sha256: sha, extraction_status: "text", page_texts: [], page_count: 2, storage_path: storagePath });
  if (withOriginal) db.objects.set(storagePath, PDF_BYTES);
}

async function drive(jobId: string, maxSteps = 30) {
  const kinds: string[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const body = await (await advance(new Request("http://x", { method: "POST" }), ctx(jobId))).json();
    kinds.push(body.outcome.kind);
    if (body.outcome.kind === "done" || body.outcome.kind === "failed") return { kinds, body };
  }
  throw new Error("não terminou");
}

beforeEach(() => {
  db = new FakeDb();
  vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireUser.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("flag, autenticação e validação", () => {
  it("404 com a flag desligada; 401 sem sessão", async () => {
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "false");
    expect((await createJob(post({}))).status).toBe(404);
    expect((await listJobs(new Request("http://x/api/jobs"))).status).toBe(404);
    expect((await getJob(new Request("http://x"), ctx(D1))).status).toBe(404);
    expect((await advance(new Request("http://x"), ctx(D1))).status).toBe(404);
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
    requireUser.mockRejectedValue(new ApiError(401, "unauthenticated", "x"));
    expect((await createJob(post({}))).status).toBe(401);
    expect((await advance(new Request("http://x"), ctx(D1))).status).toBe(401);
  });
  it("400 para nome vazio, lista vazia/grande demais, ids malformados", async () => {
    login();
    expect((await createJob(post({ name: "", documentIds: [D1] }))).status).toBe(400);
    expect((await createJob(post({ name: "ok", documentIds: [] }))).status).toBe(400);
    expect((await createJob(post({ name: "ok", documentIds: ["não-uuid"] }))).status).toBe(400);
    expect((await createJob(post({ name: "ok", documentIds: Array.from({ length: 51 }, (_, i) => `d${String(i).padStart(7, "0")}-1111-4111-8111-111111111111`) }))).status).toBe(400);
    expect((await createJob(post({ notebookId: "../x" }))).status).toBe(400);
    expect((await getJob(new Request("http://x"), ctx("../../x"))).status).toBe(400);
    expect((await advance(new Request("http://x"), ctx("../../x"))).status).toBe(400);
  });
  it("404 para job inexistente e para documento de outro usuário", async () => {
    seedDocument(D1, "h1", OTHER);
    login();
    expect((await getJob(new Request("http://x"), ctx(D2))).status).toBe(404);
    expect((await advance(new Request("http://x"), ctx(D2))).status).toBe(404);
    expect((await createJob(post({ name: "x", documentIds: [D1] }))).status).toBe(404);
    expect(db.tables.notebooks).toHaveLength(0);
  });
});

describe("ciclo completo via API", () => {
  it("cria o caderno e o job, processa etapa por etapa e conclui", async () => {
    seedDocument(D1, "h1"); seedDocument(D2, "h2");
    login();
    const created = await createJob(post({ name: "Caderno teste", documentIds: [D1, D2, D1] }));
    expect(created.status).toBe(201);
    const { view } = await created.json();
    expect(view.progress).toMatchObject({ done: 0, total: 4, percent: 0 });
    expect(db.tables.notebook_sources).toHaveLength(2);
    const { kinds, body } = await drive(view.job.id);
    expect(kinds).toEqual(["progressed", "progressed", "progressed", "progressed", "done"]);
    expect(body.view.job.status).toBe("succeeded");
    expect(body.view.progress.percent).toBe(100);
  });
  it("a visão pública NUNCA expõe a saída das etapas (texto dos documentos)", async () => {
    seedDocument(D1, "h1");
    login();
    const { view } = await (await createJob(post({ name: "n", documentIds: [D1] }))).json();
    const { body } = await drive(view.job.id);
    expect(db.tables.job_stages.some((row) => JSON.stringify(row.output).includes(SECRET_TEXT))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET_TEXT);
    expect(JSON.stringify(await (await getJob(new Request("http://x"), ctx(view.job.id))).json())).not.toContain(SECRET_TEXT);
    expect(JSON.stringify(await (await listJobs(new Request("http://x/api/jobs"))).json())).not.toContain(SECRET_TEXT);
  });
  it("criar de novo com as mesmas fontes devolve o MESMO job (idempotência)", async () => {
    seedDocument(D1, "h1");
    login();
    const first = await (await createJob(post({ name: "n", documentIds: [D1] }))).json();
    const again = await createJob(post({ notebookId: db.tables.notebooks[0].id }));
    expect(again.status).toBe(200);
    expect((await again.json()).view.job.id).toBe(first.view.job.id);
    expect(db.tables.job_stages).toHaveLength(2);
  });
  it("RECARREGAR a página no meio: lista jobs ativos e continua de onde parou, sem refazer etapas", async () => {
    seedDocument(D1, "h1"); seedDocument(D2, "h2");
    login();
    const { view } = await (await createJob(post({ name: "n", documentIds: [D1, D2] }))).json();
    await advance(new Request("http://x"), ctx(view.job.id));
    await advance(new Request("http://x"), ctx(view.job.id));
    const doneBefore = db.tables.job_stages.filter((s) => s.status === "succeeded").map((s) => s.id);
    expect(doneBefore).toHaveLength(2);

    login();
    const active = await (await listJobs(new Request("http://x/api/jobs?active=1"))).json();
    expect(active.jobs).toHaveLength(1);
    expect(active.jobs[0].progress).toMatchObject({ done: 2, total: 4 });
    const { kinds } = await drive(active.jobs[0].job.id);
    expect(kinds).toEqual(["progressed", "progressed", "done"]);
    expect(db.tables.job_stages.filter((s) => doneBefore.includes(s.id)).every((s) => s.attempts === 1)).toBe(true);
  });
  it("lista só jobs ativos quando active=1 e isola usuários", async () => {
    seedDocument(D1, "h1");
    login();
    const { view } = await (await createJob(post({ name: "n", documentIds: [D1] }))).json();
    await drive(view.job.id);
    expect((await (await listJobs(new Request("http://x/api/jobs?active=1"))).json()).jobs).toHaveLength(0);
    expect((await (await listJobs(new Request("http://x/api/jobs"))).json()).jobs).toHaveLength(1);
    login(OTHER);
    expect((await (await listJobs(new Request("http://x/api/jobs"))).json()).jobs).toHaveLength(0);
    expect((await getJob(new Request("http://x"), ctx(view.job.id))).status).toBe(404);
    expect((await advance(new Request("http://x"), ctx(view.job.id))).status).toBe(404);
  });
  it("cache entre cadernos: o mesmo PDF não é reprocessado", async () => {
    seedDocument(D1, "h1");
    login();
    const first = await (await createJob(post({ name: "um", documentIds: [D1] }))).json();
    await drive(first.view.job.id);
    const second = await (await createJob(post({ name: "dois", documentIds: [D1] }))).json();
    expect(second.view.job.id).not.toBe(first.view.job.id);
    const { body } = await drive(second.view.job.id);
    expect(body.view.stages.every((s: { cacheHit: boolean }) => s.cacheHit)).toBe(true);
  });
  it("falha clara (sem retentativa) quando o arquivo original não está no armazenamento", async () => {
    seedDocument(D1, "h1", USER, false);
    login();
    const { view } = await (await createJob(post({ name: "n", documentIds: [D1] }))).json();
    const { body } = await drive(view.job.id);
    expect(body.outcome.kind).toBe("failed");
    expect(body.view.job.error).toMatch(/Reenvie o documento/);
    expect(db.tables.job_stages[0].attempts).toBe(1);
  });
});

describe("toJobView", () => {
  it("remove output e resume o progresso", () => {
    const stage = { id: "s", jobId: "j", stage: "extraction" as const, subjectId: null, position: 1, status: "succeeded" as const, attempts: 1, maxAttempts: 3, nextAttemptAt: "", leaseExpiresAt: null, inputHash: "h", output: { texto: SECRET_TEXT }, cacheHit: false, error: null, startedAt: null, finishedAt: null, durationMs: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    const job = { id: "j", notebookId: "n", kind: "build_notebook", status: "running" as const, inputHash: "h", error: null, createdAt: "", updatedAt: "", finishedAt: null };
    const view = toJobView(job, [stage]);
    expect(JSON.stringify(view)).not.toContain(SECRET_TEXT);
    expect(view.progress.percent).toBe(100);
  });
});
