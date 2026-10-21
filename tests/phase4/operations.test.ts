import { describe, expect, it } from "vitest";
import { buildThematicMap, contentSegmentIds } from "@/lib/thematic/build";
import { applyOperations, MapError, validateMap, type MapOperation } from "@/lib/thematic/operations";
import type { ThematicMap } from "@/lib/thematic/types";
import { segmentCorpus } from "./thematic.test";

async function fixture() {
  const input = await segmentCorpus(["14a-apostila-a.pdf", "14b-apostila-b.pdf"]);
  const map = buildThematicMap({ discipline: "Direito Administrativo", ...input });
  return { map, expected: contentSegmentIds(input.segmentations) };
}
const byTitle = (map: ThematicMap, title: string) => map.nodes.find((n) => n.title === title)!;
const NOW = "2026-01-01T12:00:00.000Z";

describe("operações de revisão do mapa", () => {
  it("renomear: guarda o título antigo como apelido, limpa o sinal de revisão e marca como editado", async () => {
    const { map, expected } = await fixture();
    const node = byTitle(map, "Teoria do risco administrativo");
    expect(node.needsReview).toBe(true);
    const { map: next, log } = applyOperations(map, [{ op: "rename", nodeId: node.id, title: "  Risco administrativo  " }], expected);
    const renamed = next.nodes.find((n) => n.id === node.id)!;
    expect(renamed).toMatchObject({ title: "Risco administrativo", needsReview: false, origin: "edited" });
    expect(renamed.aliases).toContain("Teoria do risco administrativo");
    expect(renamed.aliases).not.toContain("Risco administrativo");
    expect(log).toEqual(['Renomeado "Teoria do risco administrativo" para "Risco administrativo".']);
  });
  it("não altera o mapa original (imutável) e é tudo-ou-nada", async () => {
    const { map, expected } = await fixture();
    const snapshot = JSON.stringify(map);
    const node = map.nodes[1];
    expect(() => applyOperations(map, [{ op: "rename", nodeId: node.id, title: "Novo" }, { op: "rename", nodeId: "inexistente", title: "x" }], expected)).toThrow(MapError);
    expect(JSON.stringify(map)).toBe(snapshot);
  });
  it("mesclar subtemas: cobertura e fontes somadas, título do outro vira apelido, nada some", async () => {
    const { map, expected } = await fixture();
    const omission = byTitle(map, "Responsabilidade por omissao");
    const prescription = byTitle(map, "Prescricao");
    const { map: next } = applyOperations(map, [{ op: "merge", targetId: omission.id, sourceId: prescription.id }], expected);
    const merged = next.nodes.find((n) => n.id === omission.id)!;
    expect(next.nodes.some((n) => n.id === prescription.id)).toBe(false);
    expect(merged.aliases).toContain("Prescricao");
    expect(merged.documentIds).toEqual(["14a-apostila-a", "14b-apostila-b"]);
    expect(merged.singleSource).toBe(false);
    expect(merged.chars).toBe(omission.chars + prescription.chars);
    expect(validateMap(next, expected)).toEqual([]);
  });
  it("mesclar temas leva os subtemas junto", async () => {
    const { map, expected } = await fixture();
    const theme = map.nodes[0];
    const improbity = byTitle(map, "IMPROBIDADE ADMINISTRATIVA");
    const { map: next } = applyOperations(map, [{ op: "merge", targetId: improbity.id, sourceId: theme.id }], expected);
    expect(next.nodes.filter((n) => n.parentId === improbity.id)).toHaveLength(3);
    expect(next.stats.themes).toBe(1);
    expect(validateMap(next, expected)).toEqual([]);
  });
  it("mover: subtema vira tema e tema sem subtemas vira subtema", async () => {
    const { map, expected } = await fixture();
    const omission = byTitle(map, "Responsabilidade por omissao");
    const improbity = byTitle(map, "IMPROBIDADE ADMINISTRATIVA");
    const up = applyOperations(map, [{ op: "move", nodeId: omission.id, parentId: null }], expected).map;
    expect(up.nodes.find((n) => n.id === omission.id)).toMatchObject({ level: 1, parentId: null });
    const down = applyOperations(map, [{ op: "move", nodeId: improbity.id, parentId: map.nodes[0].id }], expected).map;
    expect(down.nodes.find((n) => n.id === improbity.id)).toMatchObject({ level: 2, parentId: map.nodes[0].id });
    expect(() => applyOperations(map, [{ op: "move", nodeId: map.nodes[0].id, parentId: improbity.id }], expected)).toThrow(/subtemas/);
  });
  it("mover trecho entre itens preserva a cobertura total", async () => {
    const { map, expected } = await fixture();
    const omission = byTitle(map, "Responsabilidade por omissao");
    const improbity = byTitle(map, "IMPROBIDADE ADMINISTRATIVA");
    const segmentId = omission.coverage[0].segmentId;
    const { map: next } = applyOperations(map, [{ op: "moveCoverage", segmentId, toNodeId: improbity.id }], expected);
    expect(next.nodes.find((n) => n.id === improbity.id)!.coverage.map((c) => c.segmentId)).toContain(segmentId);
    expect(next.nodes.find((n) => n.id === omission.id)!.coverage).toEqual([]);
    expect(validateMap(next, expected)).toEqual([]);
  });
  it("dividir: cria irmão logo depois, com os trechos escolhidos", async () => {
    const { map, expected } = await fixture();
    const theme = map.nodes[0];
    expect(theme.coverage.length).toBeGreaterThanOrEqual(2);
    const moved = theme.coverage[1].segmentId;
    const { map: next } = applyOperations(map, [{ op: "split", nodeId: theme.id, segmentIds: [moved], title: "Pressupostos" }], expected);
    const created = next.nodes.find((n) => n.title === "Pressupostos")!;
    expect(created).toMatchObject({ level: 1, origin: "edited", needsReview: false });
    expect(created.coverage.map((c) => c.segmentId)).toEqual([moved]);
    expect(next.nodes.findIndex((n) => n.id === created.id)).toBe(next.nodes.findIndex((n) => n.id === theme.id) + 1 + next.nodes.filter((n) => n.parentId === theme.id).length);
    expect(validateMap(next, expected)).toEqual([]);
    expect(() => applyOperations(map, [{ op: "split", nodeId: theme.id, segmentIds: theme.coverage.map((c) => c.segmentId), title: "Tudo" }], expected)).toThrow(/ao menos um trecho/);
  });
  it("ignorar NÃO apaga: o item continua no mapa, com motivo e data, e a cobertura se mantém", async () => {
    const { map, expected } = await fixture();
    const improbity = byTitle(map, "IMPROBIDADE ADMINISTRATIVA");
    const { map: next, log } = applyOperations(map, [{ op: "ignore", nodeId: improbity.id, reason: "Fora do edital", at: NOW }], expected);
    expect(next.nodes.find((n) => n.id === improbity.id)).toMatchObject({ ignored: { reason: "Fora do edital", at: NOW } });
    expect(next.nodes).toHaveLength(map.nodes.length);
    expect(next.stats.needsReview).toBeLessThanOrEqual(map.stats.needsReview);
    expect(log[0]).toMatch(/Fora do edital/);
    expect(() => applyOperations(map, [{ op: "ignore", nodeId: improbity.id, reason: "  ", at: NOW }], expected)).toThrow(/motivo/);
    const back = applyOperations(next, [{ op: "unignore", nodeId: improbity.id }], expected).map;
    expect(back.nodes.find((n) => n.id === improbity.id)!.ignored).toBeNull();
    expect(() => applyOperations(next, [{ op: "merge", targetId: map.nodes[0].id, sourceId: improbity.id }], expected)).toThrow(/ignorar/);
  });
  it.each<[string, (m: ThematicMap) => MapOperation, RegExp]>([
    ["título vazio", (m) => ({ op: "rename", nodeId: m.nodes[0].id, title: "   " }), /título/],
    ["título longo demais", (m) => ({ op: "rename", nodeId: m.nodes[0].id, title: "x".repeat(201) }), /título/],
    ["mesclar consigo mesmo", (m) => ({ op: "merge", targetId: m.nodes[0].id, sourceId: m.nodes[0].id }), /diferentes/],
    ["mesclar níveis diferentes", (m) => ({ op: "merge", targetId: m.nodes[0].id, sourceId: m.nodes[1].id }), /mesmo nível/],
    ["mover para subtema", (m) => ({ op: "move", nodeId: m.nodes[4].id, parentId: m.nodes[1].id }), /dentro de um tema/],
    ["trecho inexistente", (m) => ({ op: "moveCoverage", segmentId: "nao-existe", toNodeId: m.nodes[0].id }), /não encontrado/],
    ["dividir com trecho de outro item", (m) => ({ op: "split", nodeId: m.nodes[0].id, segmentIds: [m.nodes[4].coverage[0].segmentId], title: "x" }), /pertençam/],
  ])("rejeita: %s", async (_name, build, message) => {
    const { map, expected } = await fixture();
    expect(() => applyOperations(map, [build(map)], expected)).toThrow(message);
  });
  it("rejeita lista vazia e operação desconhecida", async () => {
    const { map } = await fixture();
    expect(() => applyOperations(map, [])).toThrow(/Nenhuma alteração/);
    expect(() => applyOperations(map, [{ op: "apagar", nodeId: map.nodes[0].id } as unknown as MapOperation])).toThrow(/desconhecida/);
  });
  it("validateMap acusa trecho duplicado, faltante, estranho e subtema órfão", async () => {
    const { map, expected } = await fixture();
    const broken = structuredClone(map);
    broken.nodes[1].coverage.push(broken.nodes[2].coverage[0]);
    broken.nodes[4].coverage = [];
    broken.nodes[3].parentId = "fantasma";
    broken.nodes[0].coverage.push({ segmentId: "estranho", documentId: "x", title: null, pages: [1], chars: 1 });
    const problems = validateMap(broken, expected);
    expect(problems.some((p) => /mais de um item/.test(p))).toBe(true);
    expect(problems.some((p) => /não está coberto/.test(p))).toBe(true);
    expect(problems.some((p) => /não existe nas fontes/.test(p))).toBe(true);
    expect(problems.some((p) => /precisa estar dentro de um tema/.test(p))).toBe(true);
  });
  it("sequência de operações mantém o mapa íntegro e a ordem contígua", async () => {
    const { map, expected } = await fixture();
    const omission = byTitle(map, "Responsabilidade por omissao");
    const { map: next } = applyOperations(map, [
      { op: "rename", nodeId: omission.id, title: "Omissão estatal" },
      { op: "move", nodeId: omission.id, parentId: null },
      { op: "ignore", nodeId: byTitle(map, "Prescricao").id, reason: "Repetido", at: NOW },
    ], expected);
    expect(next.nodes.map((n) => n.order)).toEqual(next.nodes.map((_, i) => i));
    expect(validateMap(next, expected)).toEqual([]);
    expect(next.stats.themes + next.stats.subthemes).toBe(next.nodes.length);
  });
});
