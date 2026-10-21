import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/http";
import { buildThematicMap, contentSegmentIds } from "@/lib/thematic/build";
import { MemoryMapStore } from "@/lib/thematic/memory-store";
import { validateMap } from "@/lib/thematic/operations";
import type { ThematicMap } from "@/lib/thematic/types";
import { segmentCorpus } from "./thematic.test";

const requireUser = vi.fn();
let store: MemoryMapStore;
vi.mock("@/lib/server/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/server/stores", () => ({ createMapStore: () => store }));

import { GET as getMap } from "@/app/api/notebooks/[id]/map/route";
import { POST as editMap } from "@/app/api/notebooks/[id]/map/edit/route";
import { POST as confirmMap } from "@/app/api/notebooks/[id]/map/confirm/route";

const NB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = (id = NB) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

let seeded: { map: ThematicMap; expected: string[] };
async function seed() {
  const input = await segmentCorpus(["14a-apostila-a.pdf", "14b-apostila-b.pdf"]);
  const map = buildThematicMap({ discipline: "Direito Administrativo", ...input });
  await store.saveAuto({ notebookId: NB, jobId: "job-1", map });
  seeded = { map, expected: contentSegmentIds(input.segmentations) };
}
const node = (title: string) => seeded.map.nodes.find((n) => n.title === title)!;

beforeEach(async () => {
  store = new MemoryMapStore();
  vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireUser.mockReset();
  requireUser.mockResolvedValue({ supabase: {}, user: { id: "u" } });
  await seed();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("acesso", () => {
  it("404 com a flag desligada; 401 sem sessão; 400 com id inválido", async () => {
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "false");
    expect((await getMap(new Request("http://x"), ctx())).status).toBe(404);
    expect((await editMap(post({}), ctx())).status).toBe(404);
    expect((await confirmMap(post({}), ctx())).status).toBe(404);
    vi.stubEnv("NEXT_PUBLIC_PIPELINE_V2", "true");
    expect((await getMap(new Request("http://x"), ctx("../x"))).status).toBe(400);
    expect((await editMap(post({}), ctx("nao-uuid"))).status).toBe(400);
    expect((await confirmMap(post({}), ctx("nao-uuid"))).status).toBe(400);
    requireUser.mockRejectedValue(new ApiError(401, "unauthenticated", "x"));
    expect((await getMap(new Request("http://x"), ctx())).status).toBe(401);
    expect((await editMap(post({}), ctx())).status).toBe(401);
  });
  it("404 quando o caderno não tem mapa", async () => {
    const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect((await getMap(new Request("http://x"), ctx(other))).status).toBe(404);
    expect((await editMap(post({ baseVersion: 1, operations: [{ op: "unignore", nodeId: "x" }] }), ctx(other))).status).toBe(404);
    expect((await confirmMap(post({ version: 1 }), ctx(other))).status).toBe(404);
  });
});

describe("GET /map", () => {
  it("devolve a versão mais recente e a lista de versões", async () => {
    const body = await (await getMap(new Request("http://x"), ctx())).json();
    expect(body.latest).toMatchObject({ version: 1, origin: "auto", status: "draft", discipline: "Direito Administrativo" });
    expect(body.latest.map.nodes).toHaveLength(seeded.map.nodes.length);
    expect(body.versions).toEqual([expect.objectContaining({ version: 1, status: "draft" })]);
  });
});

describe("POST /map/edit", () => {
  it("renomear cria a versão 2 (editada) e a versão 1 permanece intacta", async () => {
    const target = node("Teoria do risco administrativo");
    const response = await editMap(post({ baseVersion: 1, operations: [{ op: "rename", nodeId: target.id, title: "Risco administrativo" }] }), ctx());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.latest).toMatchObject({ version: 2, baseVersion: 1, origin: "edited", status: "draft", changeLog: ['Renomeado "Teoria do risco administrativo" para "Risco administrativo".'] });
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await store.get(NB, 1))!.map.nodes.find((n) => n.id === target.id)!.title).toBe("Teoria do risco administrativo");
  });
  it("base desatualizada: 409 e nada é criado", async () => {
    const target = node("Prescricao");
    await editMap(post({ baseVersion: 1, operations: [{ op: "rename", nodeId: target.id, title: "Prazo prescricional" }] }), ctx());
    const stale = await editMap(post({ baseVersion: 1, operations: [{ op: "rename", nodeId: target.id, title: "Outro" }] }), ctx());
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("stale_map");
    expect(await store.list(NB)).toHaveLength(2);
  });
  it("ignorar: o servidor define a data (ignora a enviada) e o item continua no mapa", async () => {
    const target = node("IMPROBIDADE ADMINISTRATIVA");
    const response = await editMap(post({ baseVersion: 1, operations: [{ op: "ignore", nodeId: target.id, reason: "Fora do edital", at: "1999-01-01T00:00:00.000Z" }] }), ctx());
    const { latest } = await response.json();
    const ignored = latest.map.nodes.find((n: { id: string }) => n.id === target.id);
    expect(ignored.ignored.reason).toBe("Fora do edital");
    expect(ignored.ignored.at).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Math.abs(Date.now() - Date.parse(ignored.ignored.at))).toBeLessThan(10_000);
    expect(latest.map.nodes).toHaveLength(seeded.map.nodes.length);
  });
  it("mesclar mantém a cobertura completa (nenhum trecho some)", async () => {
    const response = await editMap(post({ baseVersion: 1, operations: [{ op: "merge", targetId: node("Responsabilidade por omissao").id, sourceId: node("Prescricao").id }] }), ctx());
    const { latest } = await response.json();
    expect(validateMap(latest.map, seeded.expected)).toEqual([]);
    expect(latest.map.nodes.length).toBe(seeded.map.nodes.length - 1);
  });
  it.each([
    ["sem versão base", { operations: [{ op: "unignore", nodeId: "x" }] }, 400],
    ["versão base inválida", { baseVersion: 1.5, operations: [{ op: "unignore", nodeId: "x" }] }, 400],
    ["lista vazia", { baseVersion: 1, operations: [] }, 400],
    ["operação desconhecida", { baseVersion: 1, operations: [{ op: "apagar", nodeId: "x" }] }, 400],
    ["campo ausente", { baseVersion: 1, operations: [{ op: "rename", nodeId: "x" }] }, 400],
    ["lista grande demais", { baseVersion: 1, operations: Array.from({ length: 51 }, () => ({ op: "unignore", nodeId: "x" })) }, 400],
    ["item inexistente", { baseVersion: 1, operations: [{ op: "rename", nodeId: "nao-existe", title: "x" }] }, 422],
    ["mesclar níveis diferentes", { baseVersion: 1, operations: [{ op: "merge", targetId: "A", sourceId: "B" }] }, 422],
  ])("rejeita: %s", async (_name, body, status) => {
    if (JSON.stringify(body).includes('"A"')) {
      (body as { operations: { targetId: string; sourceId: string }[] }).operations[0].targetId = seeded.map.nodes[0].id;
      (body as { operations: { targetId: string; sourceId: string }[] }).operations[0].sourceId = seeded.map.nodes[1].id;
    }
    const response = await editMap(post(body), ctx());
    expect(response.status).toBe(status);
    expect(await store.list(NB)).toHaveLength(1);
  });
  it("corpo malformado: 400", async () => {
    expect((await editMap(new Request("http://x", { method: "POST", body: "não é json" }), ctx())).status).toBe(400);
  });
});

describe("POST /map/confirm", () => {
  it("confirma uma versão; confirmar outra desconfirma a anterior", async () => {
    const target = node("Prescricao");
    await editMap(post({ baseVersion: 1, operations: [{ op: "rename", nodeId: target.id, title: "Prazo prescricional" }] }), ctx());
    expect((await (await confirmMap(post({ version: 1 }), ctx())).json()).latest).toMatchObject({ version: 1, status: "confirmed" });
    const second = await (await confirmMap(post({ version: 2 }), ctx())).json();
    expect(second.latest).toMatchObject({ version: 2, status: "confirmed" });
    expect(second.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[1, "draft"], [2, "confirmed"]]);
  });
  it("versão inexistente: 404; versão inválida: 400", async () => {
    expect((await confirmMap(post({ version: 99 }), ctx())).status).toBe(404);
    expect((await confirmMap(post({ version: "1" }), ctx())).status).toBe(400);
    expect((await confirmMap(post({}), ctx())).status).toBe(400);
  });
});
