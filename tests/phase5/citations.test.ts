import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDocument } from "@/lib/cleaning/clean";
import { extractCitations } from "@/lib/citations/extract";
import { citationsForNode } from "@/lib/citations/for-theme";
import { buildCitationRegistry } from "@/lib/citations/registry";
import { verifyCitations } from "@/lib/citations/verify";
import { extractOriginal } from "@/lib/extraction";
import { segmentDocument } from "@/lib/segmentation/segment";
import { CORPUS_DIR } from "../helpers";

const keys = (text: string) => extractCitations(text).map((item) => item.key);

async function corpusRegistry() {
  const segmentations = [];
  for (const [id, name] of [["a", "18a-citacoes-a.pdf"], ["b", "18b-citacoes-b.pdf"]]) {
    const cleaned = cleanDocument(await extractOriginal("pdf", new Uint8Array(readFileSync(join(CORPUS_DIR, name)))));
    segmentations.push(segmentDocument(id, `sha-${id}`, cleaned.paragraphs));
  }
  const registry = buildCitationRegistry({ documents: [{ id: "a", title: "Apostila A" }, { id: "b", title: "Apostila B" }], segmentations });
  return { registry, segmentations };
}

describe("extração de citações: formatos equivalentes geram a mesma chave", () => {
  it("artigo/inciso da CF em escritas diferentes", () => {
    const expected = "law|CF/1988|art:5|inc:74";
    expect(keys("art. 5º, LXXIV, da CF/88")).toContain(expected);
    expect(keys("artigo 5, inciso 74, da Constituição Federal")).toContain(expected);
  });
  it("CDC é a Lei 8.078/1990", () => {
    const expected = "law|Lei 8.078/1990|art:6|inc:8";
    for (const text of ["Lei nº 8.078/90 (CDC), art. 6º, VIII", "art. 6º, inciso VIII, do CDC"]) expect(keys(text)).toContain(expected);
  });
  it("súmulas, súmula vinculante, repercussão geral e REsp", () => {
    expect(keys("Súmula 421 do STJ")).toContain("sumula:STJ:421");
    expect(keys("Súmula Vinculante 11")).toContain("sv:11");
    expect(keys("Tema 220 do STF")).toContain("theme|STF|220");
    expect(keys("REsp 1.234.567/SP")).toContain("case|REsp|1234567");
  });
  it("texto sem citação não produz nada", () => {
    expect(extractCitations("A defensoria atua na orientação jurídica dos necessitados.")).toEqual([]);
  });
  it("artigo sem diploma não é unificado com diploma conhecido", () => {
    const [item] = extractCitations("Conforme o art. 5º do texto.").filter((c) => c.kind === "law");
    if (item) expect(item.key).not.toContain("CF/1988");
  });
});

describe("registro sobre duas apostilas com citações em formatos diferentes", () => {
  it("unifica entre fontes e detecta divergências", async () => {
    const { registry } = await corpusRegistry();
    const byKey = (key: string) => registry.citations.find((citation) => citation.key === key);
    expect(registry.stats.total).toBe(13);
    expect(registry.stats.multiSource).toBe(6);
    expect(byKey("law|CF/1988|art:5|inc:74")?.documentIds.sort()).toEqual(["a", "b"]);
    expect(byKey("law|Lei 8.078/1990|art:6|inc:8")?.documentIds.sort()).toEqual(["a", "b"]);
    expect(byKey("sumula:STJ:421")?.divergences.map((d) => d.field)).toEqual(["statement"]);
    expect(byKey("case|REsp|1234567")?.divergences.map((d) => d.field).sort()).toEqual(["body", "judgedAt", "relator"]);
    expect(registry.stats.divergent).toBe(2);
  });
  it("é determinístico e toda ocorrência aponta para trecho existente", async () => {
    const first = await corpusRegistry();
    const second = await corpusRegistry();
    expect(second.registry).toEqual(first.registry);
    const segments = new Set(first.segmentations.flatMap((s) => s.segments.map((x) => x.id)));
    for (const citation of first.registry.citations) for (const occurrence of citation.occurrences) expect(segments.has(occurrence.segmentId)).toBe(true);
  });
  it("vincula citações aos nós do mapa pela cobertura", async () => {
    const { registry } = await corpusRegistry();
    const segmentId = registry.citations[0].occurrences[0].segmentId;
    const node = { coverage: [{ segmentId, documentId: "a", title: null, pages: [], chars: 1 }] };
    expect(citationsForNode(registry, node).length).toBeGreaterThan(0);
    expect(citationsForNode(registry, { coverage: [] })).toEqual([]);
  });
});

describe("verificação anti-invenção", () => {
  it("aceita citações do registro e acusa as inventadas", async () => {
    const { registry } = await corpusRegistry();
    expect(verifyCitations("Aplica-se a Súmula 421 do STJ e o art. 134 da CF/88.", registry).ok).toBe(true);
    const bad = verifyCitations("Aplica-se a Súmula 999 do STJ e o art. 134 da CF/88.", registry);
    expect(bad.ok).toBe(false);
    expect(bad.unregistered.map((c) => c.key)).toEqual(["sumula:STJ:999"]);
  });
});
