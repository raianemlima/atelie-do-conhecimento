import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORPUS_DIR } from "../helpers";
import { ApiError } from "@/lib/server/http";
import { sha256Hex } from "@/lib/server/upload-rules";

const requireUser = vi.fn();
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));

import { POST as prepare } from "@/app/api/documents/prepare/route";
import { POST as finalize } from "@/app/api/documents/finalize/route";
import { GET as download } from "@/app/api/documents/[id]/download/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "22222222-2222-4222-8222-222222222222";
const pdf = new Uint8Array(readFileSync(join(CORPUS_DIR, "01-texto-simples.pdf")));
const jsonRequest = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });

type Fake = ReturnType<typeof makeSupabase>;
function makeSupabase(opts: { object?: Uint8Array | null; existingHashes?: string[]; insertError?: { code?: string; message: string } | null; row?: Record<string, unknown> | null } = {}) {
  const removed: string[][] = [];
  const inserted: Record<string, unknown>[] = [];
  const signedUploads: string[] = [];
  const signedUrls: Array<{ path: string; ttl: number }> = [];
  const storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => { signedUploads.push(path); return { data: { signedUrl: `https://storage.test/${path}`, token: "tok", path }, error: null }; }),
    download: vi.fn(async () => (opts.object ? { data: new Blob([opts.object as BlobPart]), error: null } : { data: null, error: { message: "not found" } })),
    remove: vi.fn(async (paths: string[]) => { removed.push(paths); return { error: null }; }),
    createSignedUrl: vi.fn(async (path: string, ttl: number) => { signedUrls.push({ path, ttl }); return { data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }; }),
  };
  const supabase = {
    storage: { from: () => storage },
    from: () => ({
      select: (columns: string) => ({
        in: async () => ({ data: (opts.existingHashes ?? []).map((sha256) => ({ sha256 })), error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: columns.includes("storage_path") ? (opts.row ?? null) : null, error: null }) }),
      }),
      insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => (opts.insertError ? { data: null, error: opts.insertError } : { data: { ...row, page_texts: row.page_texts }, error: null }) }) }; },
    }),
  };
  return { supabase, storage, removed, inserted, signedUploads, signedUrls };
}

function login(fake: Fake) { requireUser.mockResolvedValue({ supabase: fake.supabase, user: { id: USER_ID } }); }
const validFinalize = (overrides: Record<string, unknown> = {}) => ({ id: DOC_ID, fileName: "01.pdf", size: pdf.length, sha256: sha256Hex(pdf), title: "Aula 1", projectId: null, extraction: { status: "text", extractedText: "texto", pageTexts: ["texto"], pageCount: 1 }, ...overrides });

beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true"); requireUser.mockReset(); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("flag e autenticação", () => {
  it("rotas respondem 404 com a flag desligada (fluxo antigo intacto)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "false");
    expect((await prepare(jsonRequest({ files: [] }))).status).toBe(404);
    expect((await finalize(jsonRequest({}))).status).toBe(404);
    expect((await download(new Request("http://x"), { params: Promise.resolve({ id: DOC_ID }) })).status).toBe(404);
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("respondem 401 sem sessão", async () => {
    requireUser.mockRejectedValue(new ApiError(401, "unauthenticated", "Sua sessão expirou."));
    expect((await prepare(jsonRequest({ files: [{}] }))).status).toBe(401);
    expect((await finalize(jsonRequest(validFinalize()))).status).toBe(401);
    expect((await download(new Request("http://x"), { params: Promise.resolve({ id: DOC_ID }) })).status).toBe(401);
  });
  it("erro inesperado vira 500 genérico, sem vazar detalhe interno", async () => {
    requireUser.mockRejectedValue(new Error("senha do banco: hunter2"));
    const response = await prepare(jsonRequest({ files: [{}] }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
  });
});

describe("POST /api/documents/prepare", () => {
  it("rejeita corpo malformado e lote vazio ou grande demais", async () => {
    login(makeSupabase());
    expect((await prepare(new Request("http://x", { method: "POST", body: "não é json" }))).status).toBe(400);
    expect((await prepare(jsonRequest({ files: [] }))).status).toBe(400);
    expect((await prepare(jsonRequest({ files: Array.from({ length: 21 }, () => ({})) }))).status).toBe(400);
  });
  it("devolve resultado por arquivo: válido, duplicado, formato e tamanho inválidos", async () => {
    const fake = makeSupabase({ existingHashes: ["b".repeat(64)] });
    login(fake);
    const response = await prepare(jsonRequest({ files: [
      { fileName: "ok.pdf", size: 10, sha256: "a".repeat(64) },
      { fileName: "dup.pdf", size: 10, sha256: "b".repeat(64) },
      { fileName: "virus.exe", size: 10, sha256: "c".repeat(64) },
      { fileName: "grande.pdf", size: 26 * 1024 * 1024, sha256: "d".repeat(64) },
      { fileName: "../x.pdf", size: 10, sha256: "e".repeat(64) },
      { fileName: "igual-ao-ok.pdf", size: 10, sha256: "a".repeat(64) },
    ] }));
    const { results } = await response.json();
    expect(results.map((r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code))).toEqual(["ok", "duplicate", "unsupported_format", "too_large", "invalid_name", "duplicate"]);
    expect(fake.signedUploads).toHaveLength(1);
    expect(fake.signedUploads[0].startsWith(`${USER_ID}/`)).toBe(true);
  });
});

describe("POST /api/documents/finalize", () => {
  it("aprova e registra um PDF íntegro, com caminho derivado do usuário autenticado", async () => {
    const fake = makeSupabase({ object: pdf });
    login(fake);
    const response = await finalize(jsonRequest(validFinalize({ storagePath: "outro-usuario/x/y.pdf", owner_id: "hacker" })));
    expect(response.status).toBe(200);
    expect(fake.inserted).toHaveLength(1);
    expect(fake.inserted[0].storage_path).toBe(`${USER_ID}/${DOC_ID}/01.pdf`);
    expect(fake.inserted[0]).not.toHaveProperty("owner_id");
    expect((await response.json()).document.storagePath).toBe(`${USER_ID}/${DOC_ID}/01.pdf`);
  });
  it("rejeita arquivo falsificado, remove o objeto e NÃO grava metadados", async () => {
    const fakeBytes = new TextEncoder().encode("MZ executável disfarçado");
    const fake = makeSupabase({ object: fakeBytes });
    login(fake);
    const body = validFinalize({ size: fakeBytes.length, sha256: sha256Hex(fakeBytes) });
    const response = await finalize(jsonRequest(body));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("format_mismatch");
    expect(fake.removed).toEqual([[`${USER_ID}/${DOC_ID}/01.pdf`]]);
    expect(fake.inserted).toHaveLength(0);
  });
  it("rejeita PDF corrompido com mensagem clara", async () => {
    const half = pdf.slice(0, Math.floor(pdf.length / 2));
    const fake = makeSupabase({ object: half });
    login(fake);
    const response = await finalize(jsonRequest(validFinalize({ size: half.length, sha256: sha256Hex(half) })));
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/incompleto ou corrompido/);
    expect(fake.inserted).toHaveLength(0);
  });
  it("rejeita hash divergente", async () => {
    login(makeSupabase({ object: pdf }));
    const response = await finalize(jsonRequest(validFinalize({ sha256: "0".repeat(64) })));
    expect((await response.json()).error.code).toBe("hash_mismatch");
  });
  it("409 quando o objeto não foi enviado", async () => {
    login(makeSupabase({ object: null }));
    expect((await finalize(jsonRequest(validFinalize()))).status).toBe(409);
  });
  it("409 em duplicata concorrente e limpa o objeto", async () => {
    const fake = makeSupabase({ object: pdf, insertError: { code: "23505", message: "duplicate key" } });
    login(fake);
    const response = await finalize(jsonRequest(validFinalize()));
    expect(response.status).toBe(409);
    expect(fake.removed).toHaveLength(1);
  });
  it("valida entradas: id, nome com '..', extração malformada", async () => {
    login(makeSupabase({ object: pdf }));
    expect((await finalize(jsonRequest(validFinalize({ id: "não-é-uuid" })))).status).toBe(400);
    expect((await finalize(jsonRequest(validFinalize({ fileName: "../../x.pdf" })))).status).toBe(422);
    expect((await finalize(jsonRequest(validFinalize({ extraction: { status: "hack" } })))).status).toBe(400);
    expect((await finalize(jsonRequest(validFinalize({ extraction: { status: "text", extractedText: "x", pageTexts: [1], pageCount: 1 } })))).status).toBe(400);
  });
});

describe("GET /api/documents/[id]/download", () => {
  const call = (id: string) => download(new Request("http://x"), { params: Promise.resolve({ id }) });
  it("devolve URL assinada de 60 s para documento do próprio usuário", async () => {
    const fake = makeSupabase({ row: { storage_path: `${USER_ID}/${DOC_ID}/01.pdf`, file_name: "01.pdf" } });
    login(fake);
    const response = await call(DOC_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ expiresInSeconds: 60 });
    expect(fake.signedUrls).toEqual([{ path: `${USER_ID}/${DOC_ID}/01.pdf`, ttl: 60 }]);
  });
  it("404 para documento inexistente ou de outro usuário (RLS devolve vazio)", async () => {
    const fake = makeSupabase({ row: null });
    login(fake);
    expect((await call(DOC_ID)).status).toBe(404);
    expect(fake.signedUrls).toHaveLength(0);
  });
  it("400 para id inválido", async () => {
    login(makeSupabase());
    expect((await call("../../etc/passwd")).status).toBe(400);
  });
});
