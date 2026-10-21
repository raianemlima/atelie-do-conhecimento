import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDocument } from "@/lib/cleaning/clean";
import { extractOriginal } from "@/lib/extraction";
import { segmentDocument } from "@/lib/segmentation/segment";
import type { SegmentationResult } from "@/lib/segmentation/types";
import { buildThematicMap, contentSegmentIds } from "@/lib/thematic/build";
import { validateMap } from "@/lib/thematic/operations";
import { isGenericTitle, normalizeTitle, titleSimilarity, titleTokens } from "@/lib/thematic/titles";
import { INTRO_TITLE } from "@/lib/thematic/types";
import { CORPUS_DIR } from "../helpers";

const idOf = (file: string) => file.replace(/\.pdf$/, "");

export async function segmentCorpus(files: string[]): Promise<{ documents: { id: string; title: string }[]; segmentations: SegmentationResult[] }> {
  const segmentations: SegmentationResult[] = [];
  for (const file of files) {
    const cleaned = cleanDocument(await extractOriginal("pdf", new Uint8Array(readFileSync(join(CORPUS_DIR, file)))));
    segmentations.push(segmentDocument(idOf(file), `sha-${file}`, cleaned.paragraphs));
  }
  return { documents: files.map((file) => ({ id: idOf(file), title: idOf(file) })), segmentations };
}

const summary = (map: ReturnType<typeof buildThematicMap>) => map.nodes.map((n) => `${"  ".repeat(n.level - 1)}${n.title}${n.singleSource ? " [fonte única]" : ""}${n.needsReview ? " [revisar]" : ""}`);

describe("títulos: similaridade", () => {
  it("normaliza acentos, caixa, artigos, plural e números", () => {
    expect(titleTokens("Responsabilidade CIVIL do Estado")).toEqual(["responsabilidade", "civil", "estado"]);
    expect(titleTokens("Atos Administrativos")).toEqual(["ato", "administrativo"]);
    expect(titleTokens("Omissão e Prescrição")).toEqual(["omissao", "prescricao"]);
    expect(normalizeTitle("Teorias da responsabilidade")).toBe(normalizeTitle("TEORIA DE RESPONSABILIDADE"));
  });
  it.each([
    ["Responsabilidade civil do Estado", "RESPONSABILIDADE CIVIL DO ESTADO", 1],
    ["Teoria do risco administrativo", "Risco administrativo", 0.833],
    ["Responsabilidade civil extracontratual do Estado", "Responsabilidade civil do Estado", 0.875],
    ["Responsabilidade civil", "Responsabilidade penal", 0.417],
    ["Prescrição", "Improbidade administrativa", 0],
  ])("%s x %s", (a, b, expected) => {
    expect(titleSimilarity(a, b)).toBeCloseTo(expected, 2);
  });
  it("detecta títulos genéricos", () => {
    expect(isGenericTitle("Introdução")).toBe(true);
    expect(isGenericTitle("Conceito e Noções")).toBe(true);
    expect(isGenericTitle("Conceito de hipossuficiência")).toBe(false);
  });
});

describe("mapa temático de fontes reais do corpus", () => {
  it("duas apostilas do mesmo tema: temas e subtemas fundidos, únicos sinalizados", async () => {
    const input = await segmentCorpus(["14a-apostila-a.pdf", "14b-apostila-b.pdf"]);
    const map = buildThematicMap({ discipline: "Direito Administrativo", ...input });
    expect(summary(map)).toEqual([
      "Responsabilidade civil extracontratual do Estado",
      "  Teoria do risco administrativo [revisar]",
      "  Responsabilidade por omissao [fonte única]",
      "  Prescricao [fonte única]",
      "IMPROBIDADE ADMINISTRATIVA [fonte única]",
    ]);
    const [theme, risk, omission, prescription, improbity] = map.nodes;
    expect(theme).toMatchObject({ level: 1, parentId: null, aliases: ["RESPONSABILIDADE CIVIL DO ESTADO"], confidence: 0.875, needsReview: false, documentIds: ["14a-apostila-a", "14b-apostila-b"] });
    expect(risk).toMatchObject({ level: 2, parentId: theme.id, aliases: ["Risco administrativo"], documentIds: ["14a-apostila-a", "14b-apostila-b"] });
    expect(risk.confidence).toBeCloseTo(0.833, 2);
    expect(omission.documentIds).toEqual(["14a-apostila-a"]);
    expect(prescription.documentIds).toEqual(["14b-apostila-b"]);
    expect(improbity.parentId).toBeNull();
    expect(map.stats).toMatchObject({ themes: 2, subthemes: 3, singleSourceThemes: 1, needsReview: 1 });
    expect(map.discipline).toBe("Direito Administrativo");
  });
  it("cobertura: cada trecho com conteúdo aparece em exatamente um item, com fonte e páginas", async () => {
    for (const files of [["14a-apostila-a.pdf", "14b-apostila-b.pdf"], ["15-lei-seca.pdf", "16-sem-estrutura.pdf", "17-com-sumario.pdf"], ["04-ruidoso.pdf", "05-citacoes.pdf", "14a-apostila-a.pdf"]]) {
      const input = await segmentCorpus(files);
      const map = buildThematicMap({ discipline: "Geral", ...input });
      expect(validateMap(map, contentSegmentIds(input.segmentations)), files.join(",")).toEqual([]);
      const covered = map.nodes.flatMap((n) => n.coverage);
      expect(covered.every((item) => item.pages.length > 0 && item.documentId && item.chars > 0)).toBe(true);
      expect(map.stats.chars).toBe(input.segmentations.flatMap((s) => s.segments).reduce((total, segment) => total + segment.chars, 0));
    }
  });
  it("lei seca: artigos ficam no capítulo; título vira tema e capítulo vira subtema", async () => {
    const input = await segmentCorpus(["15-lei-seca.pdf"]);
    const map = buildThematicMap({ discipline: "Direito Constitucional", ...input });
    expect(summary(map)).toEqual(["DOS DIREITOS E GARANTIAS FUNDAMENTAIS", "  DOS DIREITOS E DEVERES INDIVIDUAIS E COLETIVOS"]);
    expect(map.nodes[0].coverage).toEqual([]);
    expect(map.nodes[1].coverage.map((c) => c.title)).toEqual(["Art. 5º", "Art. 6º"]);
  });
  it("sumário não vira tema e documento sem estrutura vira um tema próprio a revisar", async () => {
    const map = buildThematicMap({ discipline: "Geral", ...(await segmentCorpus(["17-com-sumario.pdf", "16-sem-estrutura.pdf"])) });
    expect(summary(map)).toEqual(["RESPONSABILIDADE CIVIL DO ESTADO [fonte única]", "IMPROBIDADE ADMINISTRATIVA [fonte única]", "16-sem-estrutura [fonte única] [revisar]"]);
    expect(map.warnings).toEqual([expect.stringMatching(/16-sem-estrutura.*não tem títulos reconhecíveis/)]);
  });
  it("é determinístico: mesmas fontes, mesmo mapa (ids e ordem)", async () => {
    const input = await segmentCorpus(["14a-apostila-a.pdf", "14b-apostila-b.pdf"]);
    const first = buildThematicMap({ discipline: "D", ...input });
    const second = buildThematicMap({ discipline: "D", ...input });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(new Set(first.nodes.map((n) => n.id)).size).toBe(first.nodes.length);
  });
  it("com uma única fonte, nada é marcado como 'fonte única'", async () => {
    const map = buildThematicMap({ discipline: "D", ...(await segmentCorpus(["14a-apostila-a.pdf"])) });
    expect(map.nodes.some((n) => n.singleSource)).toBe(false);
  });
  it("limiar mais alto separa o que o padrão funde", async () => {
    const input = await segmentCorpus(["14a-apostila-a.pdf", "14b-apostila-b.pdf"]);
    const strict = buildThematicMap({ discipline: "D", ...input }, { threshold: 0.9 });
    expect(strict.stats.themes).toBe(3);
    expect(validateMap(strict, contentSegmentIds(input.segmentations))).toEqual([]);
  });
});

function fakeSegmentation(documentId: string, items: { level: number; title: string | null; chars: number; kind?: "section" | "article" | "preamble" }[]): SegmentationResult {
  const segments = items.map((item, order) => ({ id: `${documentId}-${order}`, documentId, order, level: item.level, kind: item.kind ?? (item.title === null ? "preamble" as const : "section" as const), numbering: null, title: item.title, path: [], paragraphs: item.chars ? [{ text: "x".repeat(item.chars), pages: [order + 1], kind: "body" as const }] : [], pages: item.chars ? [order + 1] : [], chars: item.chars, container: item.chars === 0, windows: [] }));
  return { documentId, segments, ignored: [], warnings: [], stats: { paragraphs: segments.length, segments: segments.length, headings: segments.length, chars: items.reduce((t, i) => t + i.chars, 0) } };
}
const docs = (...ids: string[]) => ids.map((id) => ({ id, title: id }));

describe("regras do mapa (casos sintéticos)", () => {
  it("conteúdo antes do primeiro título vai para um item de 'conteúdo introdutório' a revisar", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a", "b"), segmentations: [fakeSegmentation("a", [{ level: 0, title: null, chars: 50 }, { level: 1, title: "Atos administrativos", chars: 80 }, { level: 1, title: "Poderes da administração", chars: 80 }]), fakeSegmentation("b", [{ level: 1, title: "Ato administrativo", chars: 60 }, { level: 1, title: "Licitação", chars: 60 }])] });
    expect(map.nodes.at(-1)).toMatchObject({ title: INTRO_TITLE, needsReview: true, singleSource: true });
    expect(map.nodes.find((n) => n.title === "Atos administrativos")?.documentIds).toEqual(["a", "b"]);
    expect(validateMap(map, ["a-0", "a-1", "a-2", "b-0", "b-1"])).toEqual([]);
  });
  it("níveis mais profundos são dobrados no subtema mais próximo (nada se perde)", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a"), segmentations: [fakeSegmentation("a", [{ level: 1, title: "Tema um", chars: 10 }, { level: 2, title: "Sub um", chars: 20 }, { level: 3, title: "Detalhe", chars: 30 }, { level: 1, title: "Tema dois", chars: 40 }])] });
    expect(map.nodes.map((n) => [n.level, n.title, n.chars])).toEqual([[1, "Tema um", 10], [2, "Sub um", 50], [1, "Tema dois", 40]]);
  });
  it("documento cujo único título é o do próprio documento usa o nível seguinte como tema", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a"), segmentations: [fakeSegmentation("a", [{ level: 1, title: "Apostila de Direito", chars: 0 }, { level: 2, title: "Tema A", chars: 10 }, { level: 2, title: "Tema B", chars: 10 }])] });
    expect(map.nodes.filter((n) => n.level === 1).map((n) => n.title)).toEqual(["Tema A", "Tema B"]);
  });
  it("títulos iguais dentro do MESMO documento não são fundidos por semelhança parcial", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a", "b"), segmentations: [fakeSegmentation("a", [{ level: 1, title: "Prescrição administrativa", chars: 10 }, { level: 1, title: "Prescrição da pretensão administrativa", chars: 10 }]), fakeSegmentation("b", [{ level: 1, title: "Outro assunto", chars: 10 }])] });
    expect(map.nodes.filter((n) => n.level === 1)).toHaveLength(3);
  });
  it("título genérico fundido entre fontes exige revisão", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a", "b"), segmentations: [fakeSegmentation("a", [{ level: 1, title: "Introdução", chars: 10 }, { level: 1, title: "Tema", chars: 10 }]), fakeSegmentation("b", [{ level: 1, title: "Introdução", chars: 10 }, { level: 1, title: "Outro", chars: 10 }])] });
    expect(map.nodes.find((n) => n.title === "Introdução")).toMatchObject({ needsReview: true, documentIds: ["a", "b"] });
  });
  it("documento sem conteúdo gera aviso e não quebra", () => {
    const map = buildThematicMap({ discipline: "D", documents: docs("a", "b"), segmentations: [fakeSegmentation("a", [{ level: 1, title: "Tema", chars: 10 }, { level: 1, title: "Outro", chars: 10 }]), fakeSegmentation("b", [])] });
    expect(map.warnings).toEqual([expect.stringMatching(/"b" não tem conteúdo/)]);
  });
});
