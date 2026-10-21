import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HANDLERS } from "@/lib/pipeline/handlers";
import { DEFAULT_CLEANING_SETTINGS, isDefaultSettings, MAX_SETTING_ITEMS, parseCleaningSettings, SettingsError, settingsKey } from "@/lib/pipeline/options";
import { jobInputHash } from "@/lib/pipeline/plan";
import { CORPUS_DIR } from "../helpers";
import { FakeDb, makeFakeSupabase } from "../phase2/fake-supabase";

const requireUser = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));

import { POST as createJob } from "@/app/api/jobs/route";
import { POST as advance } from "@/app/api/jobs/[id]/advance/route";

const USER = "11111111-1111-4111-8111-111111111111";
const D1 = "d1111111-1111-4111-8111-111111111111";
let db: FakeDb;
const post = (body: unknown) => new Request("http://x/api/jobs", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function seed(id = D1, file = "13-professor.pdf") {
  const path = `${USER}/${id}/original.pdf`;
  db.tables.documents.push({ id, owner_id: USER, format: "pdf", sha256: `sha-${file}`, extraction_status: "text", page_texts: [], page_count: 1, storage_path: path });
  db.objects.set(path, new Uint8Array(readFileSync(join(CORPUS_DIR, file))));
}

async function runJob(options?: unknown) {
  const created = await createJob(post({ name: "Caderno", documentIds: [D1], ...(options === undefined ? {} : { options }) }));
  if (created.status >= 400) return { created, text: null, jobId: null };
  const { view } = await created.json();
  for (let i = 0; i < 20; i += 1) {
    const body = await (await advance(new Request("http://x", { method: "POST" }), ctx(view.job.id))).json();
    if (body.outcome.kind === "done" || body.outcome.kind === "failed") break;
  }
  const cleaning = db.tables.job_stages.find((row) => row.job_id === view.job.id && row.stage === "cleaning");
  return { created, text: (cleaning?.output as { text: string } | null)?.text ?? null, jobId: view.job.id as string };
}

beforeEach(() => {
  db = new FakeDb();
  vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireUser.mockReset();
  requireUser.mockResolvedValue({ supabase: makeFakeSupabase(db, USER), user: { id: USER } });
  seed();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("opções de limpeza: validação", () => {
  it("normaliza, remove duplicatas e vazios", () => {
    expect(parseCleaningSettings({ knownTerms: ["  Escola   Alfa ", "Escola Alfa", "", "  "], keepReferences: ["Celso"], keepProfessors: true })).toEqual({ knownTerms: ["Escola Alfa"], keepReferences: ["Celso"], keepProfessors: true });
    expect(parseCleaningSettings(undefined)).toEqual(DEFAULT_CLEANING_SETTINGS);
    expect(isDefaultSettings(DEFAULT_CLEANING_SETTINGS)).toBe(true);
  });
  it.each([
    ["não é objeto", "texto"],
    ["lista inválida", { knownTerms: "Escola" }],
    ["item não textual", { keepReferences: [1] }],
    ["booleano inválido", { keepProfessors: "sim" }],
    ["itens demais", { knownTerms: Array.from({ length: MAX_SETTING_ITEMS + 1 }, (_, i) => `t${i}`) }],
    ["item longo demais", { keepReferences: ["x".repeat(201)] }],
  ])("rejeita %s", (_label, raw) => {
    expect(() => parseCleaningSettings(raw)).toThrow(SettingsError);
  });
  it("a chave de opções não depende da ordem", () => {
    expect(settingsKey({ knownTerms: ["b", "a"], keepReferences: [], keepProfessors: false })).toBe(settingsKey({ knownTerms: ["a", "b"], keepReferences: [], keepProfessors: false }));
  });
  it("opções diferentes geram jobs diferentes (hash do job)", () => {
    const docs = [{ sha256: "h" }];
    const base = jobInputHash(docs, DEFAULT_HANDLERS, DEFAULT_CLEANING_SETTINGS);
    expect(jobInputHash(docs, DEFAULT_HANDLERS, { ...DEFAULT_CLEANING_SETTINGS, keepProfessors: true })).not.toBe(base);
    expect(jobInputHash(docs, DEFAULT_HANDLERS, { ...DEFAULT_CLEANING_SETTINGS, knownTerms: ["x"] })).not.toBe(base);
  });
});

describe("API: opções valem de ponta a ponta", () => {
  it("padrão: professor removido; autor doutrinário preservado", async () => {
    const { text } = await runJob();
    expect(text).not.toMatch(/Prof\./);
    expect(text).not.toContain("Fulano de Tal");
    expect(text).toContain("O ato administrativo vinculado não admite juízo de conveniência.");
    expect(text).toContain("A doutrina de Celso Antônio Bandeira de Mello aponta que a discricionariedade tem limites legais.");
    expect(text).toContain("O controle judicial alcança a legalidade do ato.");
    expect(db.tables.notebooks[0]).not.toHaveProperty("keep_professors");
  });
  it("keepProfessors: mantém as menções e grava a opção no caderno", async () => {
    const { text } = await runJob({ keepProfessors: true });
    expect(text).toContain("Segundo o Prof. Fulano de Tal, o ato administrativo vinculado");
    expect(text).toContain("O Prof. Fulano de Tal explica que o controle judicial");
    expect(db.tables.notebooks[0]).toMatchObject({ keep_professors: true, known_terms: [], keep_references: [] });
  });
  it("keepReferences: protege só a referência escolhida", async () => {
    const { text } = await runJob({ keepReferences: ["Fulano de Tal"] });
    expect(text).toContain("Prof. Fulano de Tal");
    expect(db.tables.notebooks[0].keep_references).toEqual(["Fulano de Tal"]);
  });
  it("knownTerms: remove o termo informado do corpo", async () => {
    const { text } = await runJob({ knownTerms: ["limites legais"], keepProfessors: true });
    expect(text).not.toContain("limites legais");
  });
  it("opções inválidas ou junto de notebookId são recusadas com 400", async () => {
    expect((await runJob({ knownTerms: "Escola" })).created.status).toBe(400);
    expect((await createJob(post({ notebookId: "22222222-2222-4222-8222-222222222222", options: { keepProfessors: true } }))).status).toBe(400);
    expect(db.tables.notebooks).toHaveLength(0);
  });
  it("job de caderno existente reaproveita as opções do caderno (padrão do caderno vale no advance)", async () => {
    const first = await runJob({ keepProfessors: true });
    const again = await createJob(post({ notebookId: db.tables.notebooks[0].id }));
    expect(again.status).toBe(200);
    expect((await again.json()).view.job.id).toBe(first.jobId);
  });
  it("mudar a opção reaproveita a extração (cache) e refaz só a limpeza", async () => {
    const first = await runJob();
    const second = await runJob({ keepProfessors: true });
    expect(second.jobId).not.toBe(first.jobId);
    const stages = db.tables.job_stages.filter((row) => row.job_id === second.jobId);
    expect(stages.find((row) => row.stage === "extraction")?.cache_hit).toBe(true);
    expect(stages.find((row) => row.stage === "cleaning")?.cache_hit).toBe(false);
  });
});
