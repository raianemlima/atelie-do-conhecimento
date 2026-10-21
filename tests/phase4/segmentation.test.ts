import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDocument } from "@/lib/cleaning/clean";
import { extractOriginal } from "@/lib/extraction";
import { classifyHeading } from "@/lib/segmentation/headings";
import { buildWindows, segmentDocument, type SegmentInput } from "@/lib/segmentation/segment";
import type { SegmentParagraph } from "@/lib/segmentation/types";
import { CORPUS_DIR } from "../helpers";

async function segmentsOf(file: string, sha = `sha-${file}`) {
  const cleaned = cleanDocument(await extractOriginal("pdf", new Uint8Array(readFileSync(join(CORPUS_DIR, file)))));
  return { cleaned, result: segmentDocument("doc", sha, cleaned.paragraphs) };
}
const shape = (segments: Awaited<ReturnType<typeof segmentsOf>>["result"]["segments"]) => segments.map((s) => [s.level, s.numbering, s.title]);
const para = (text: string, heading = false, fontSize = 10.5): SegmentInput => ({ text, pages: [1], kind: "body", heading, fontSize });

describe("estrutura de documentos reais do corpus", () => {
  it("apostila com títulos numerados (1., 1.1, 1.2, 2.)", async () => {
    const { result } = await segmentsOf("14a-apostila-a.pdf");
    expect(shape(result.segments)).toEqual([[1, "1", "RESPONSABILIDADE CIVIL DO ESTADO"], [2, "1.1", "Teoria do risco administrativo"], [2, "1.2", "Responsabilidade por omissao"], [1, "2", "IMPROBIDADE ADMINISTRATIVA"]]);
    expect(result.segments[1].path).toEqual(["RESPONSABILIDADE CIVIL DO ESTADO"]);
    expect(result.segments[3].path).toEqual([]);
    expect(result.segments.every((s) => s.chars > 0 && !s.container)).toBe(true);
  });
  it("títulos só por corpo de fonte: níveis vêm do tamanho (maior = nível 1)", async () => {
    const { result } = await segmentsOf("14b-apostila-b.pdf");
    expect(shape(result.segments)).toEqual([[1, null, "Responsabilidade civil extracontratual do Estado"], [2, null, "Risco administrativo"], [2, null, "Prescricao"]]);
    expect(result.segments[2].path).toEqual(["Responsabilidade civil extracontratual do Estado"]);
  });
  it("lei seca: Título > Capítulo > artigos, com incisos dentro do artigo", async () => {
    const { result } = await segmentsOf("15-lei-seca.pdf");
    expect(result.segments.map((s) => [s.kind, s.numbering, s.container])).toEqual([["section", "TITULO II", true], ["section", "CAPITULO I", true], ["article", "Art. 5º", false], ["article", "Art. 6º", false]]);
    expect(result.segments[0].title).toBe("DOS DIREITOS E GARANTIAS FUNDAMENTAIS");
    const art5 = result.segments[2];
    expect(art5.paragraphs).toHaveLength(3);
    expect(art5.paragraphs[1].text).toMatch(/^I - homens e mulheres/);
    expect(art5.paragraphs[2].text).toMatch(/^II - ninguem sera obrigado/);
    expect(art5.path).toEqual(["DOS DIREITOS E GARANTIAS FUNDAMENTAIS", "DOS DIREITOS E DEVERES INDIVIDUAIS E COLETIVOS"]);
  });
  it("sumário com pontilhado é ignorado (e registrado), nunca vira tema", async () => {
    const { result } = await segmentsOf("17-com-sumario.pdf");
    expect(result.ignored.map((i) => i.reason)).toEqual(["toc_title", "toc_entry", "toc_entry"]);
    expect(shape(result.segments)).toEqual([[1, "1", "RESPONSABILIDADE CIVIL DO ESTADO"], [1, "2", "IMPROBIDADE ADMINISTRATIVA"]]);
    expect(result.segments.every((s) => s.chars > 0)).toBe(true);
  });
  it("documento sem títulos: um trecho de preâmbulo e aviso explícito", async () => {
    const { result, cleaned } = await segmentsOf("16-sem-estrutura.pdf");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ kind: "preamble", title: null, level: 0 });
    expect(result.segments[0].paragraphs).toHaveLength(cleaned.paragraphs.length);
    expect(result.warnings).toEqual([expect.stringMatching(/não tem títulos reconhecíveis/)]);
  });
});

describe("completude: nada se perde na segmentação", () => {
  it.each(["14a-apostila-a.pdf", "14b-apostila-b.pdf", "15-lei-seca.pdf", "16-sem-estrutura.pdf", "17-com-sumario.pdf", "04-ruidoso.pdf", "05-citacoes.pdf"])("%s: todo parágrafo vira conteúdo de segmento, título ou item ignorado", async (file) => {
    const { cleaned, result } = await segmentsOf(file);
    const inSegments = result.segments.reduce((total, s) => total + s.paragraphs.length, 0);
    const titles = result.segments.filter((s) => s.kind === "section" && s.title !== null).length;
    const articleStarts = result.segments.filter((s) => s.kind === "article").length;
    const consumedContinuations = cleaned.paragraphs.length - (inSegments - articleStarts + titles + result.ignored.length);
    expect(consumedContinuations).toBeGreaterThanOrEqual(0);
    const text = result.segments.flatMap((s) => s.paragraphs.map((p) => p.text)).join(" ");
    for (const paragraph of cleaned.paragraphs) {
      const accounted = text.includes(paragraph.text) || result.segments.some((s) => (s.title !== null && paragraph.text.includes(s.title)) || (s.numbering !== null && paragraph.text.startsWith(s.numbering.replace("º", "")))) || result.ignored.some((i) => i.text === paragraph.text);
      expect(accounted, paragraph.text.slice(0, 50)).toBe(true);
    }
  });
  it("não altera a entrada e gera ids estáveis (mesmo documento) e distintos (outro documento)", async () => {
    const cleaned = cleanDocument(await extractOriginal("pdf", new Uint8Array(readFileSync(join(CORPUS_DIR, "14a-apostila-a.pdf")))));
    const before = JSON.stringify(cleaned.paragraphs);
    const first = segmentDocument("d", "sha-1", cleaned.paragraphs);
    const again = segmentDocument("d", "sha-1", cleaned.paragraphs);
    const other = segmentDocument("d", "sha-2", cleaned.paragraphs);
    expect(JSON.stringify(cleaned.paragraphs)).toBe(before);
    expect(again.segments.map((s) => s.id)).toEqual(first.segments.map((s) => s.id));
    expect(other.segments.map((s) => s.id)).not.toEqual(first.segments.map((s) => s.id));
    expect(new Set(first.segments.map((s) => s.id)).size).toBe(first.segments.length);
  });
});

describe("reconhecimento de títulos", () => {
  it.each([
    ["1. Responsabilidade civil", false, "numbered", 1, "1"],
    ["2.3.1 Prazo prescricional", false, "numbered", 3, "2.3.1"],
    ["CAPÍTULO II DOS DIREITOS SOCIAIS", false, "structural", 2, "CAPÍTULO II"],
    ["SEÇÃO III", false, "structural", 3, "SEÇÃO III"],
    ["TÍTULO I", false, "structural", 1, "TÍTULO I"],
    ["Art. 134. A Defensoria Pública é instituição permanente, essencial à função jurisdicional do Estado, incumbindo-lhe a orientação jurídica e a defesa dos necessitados em todos os graus, de forma integral e gratuita.", false, "article", 9, "Art. 134º"],
    ["Art. 5o Todos são iguais perante a lei", false, "article", 9, "Art. 5º"],
    ["Conceito de hipossuficiência", true, "styled", 0, null],
  ])("%s", (text, styled, kind, level, numbering) => {
    expect(classifyHeading(text, styled as boolean)).toMatchObject({ kind, level, numbering });
  });
  it.each([
    "1. O prazo é de cinco anos, contado da data do fato, e não admite suspensão.",
    "I - homens e mulheres são iguais em direitos e obrigações;",
    "Texto comum de parágrafo que não é título.",
    "1. Item da lista terminado com ponto.",
    "A. Introdução",
    "Responsabilidade ............ 4",
  ])("não é título: %s", (text) => {
    expect(classifyHeading(text, false)).toBeNull();
  });
  it("estrutural sem nome pega o nome do parágrafo seguinte (em maiúsculas)", () => {
    const result = segmentDocument("d", "s", [para("TÍTULO II"), para("DOS DIREITOS E GARANTIAS FUNDAMENTAIS", true), para("Texto do título.")]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ numbering: "TÍTULO II", title: "DOS DIREITOS E GARANTIAS FUNDAMENTAIS" });
    expect(result.segments[0].paragraphs.map((p) => p.text)).toEqual(["Texto do título."]);
  });
  it("tabelas e notas de rodapé nunca viram título", () => {
    const result = segmentDocument("d", "s", [para("1. Tema"), { text: "1. Coluna | 2. Outra", pages: [1], kind: "table", heading: true, fontSize: 12 }, { text: "1 Nota de rodapé", pages: [1], kind: "footnote", heading: true, fontSize: 8 }]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].paragraphs.map((p) => p.kind)).toEqual(["table", "footnote"]);
  });
});

describe("janelas com sobreposição controlada", () => {
  const paragraphs = (sizes: number[]): SegmentParagraph[] => sizes.map((size, i) => ({ text: `${i}`.padEnd(size, "x"), pages: [1], kind: "body" as const }));
  it("segmento curto: uma janela só, sem sobreposição", () => {
    expect(buildWindows(paragraphs([100, 200]), 6000, 400)).toEqual([{ from: 0, core: [0, 2] }]);
  });
  it("trecho longo: núcleos particionam tudo; nenhuma janela estoura o limite; sobreposição ≤ limite", () => {
    const sizes = Array.from({ length: 30 }, (_, i) => 500 + (i % 5) * 100);
    const items = paragraphs(sizes);
    const windows = buildWindows(items, 3000, 700);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].core[0]).toBe(0);
    expect(windows.at(-1)?.core[1]).toBe(items.length);
    windows.forEach((w, i) => {
      if (i > 0) expect(w.core[0]).toBe(windows[i - 1].core[1]);
      const text = items.slice(w.from, w.core[1]).reduce((t, p) => t + p.text.length + 2, 0);
      const overlap = items.slice(w.from, w.core[0]).reduce((t, p) => t + p.text.length + 2, 0);
      expect(overlap).toBeLessThanOrEqual(700);
      expect(text - overlap).toBeLessThanOrEqual(3000);
      expect(w.from).toBeLessThanOrEqual(w.core[0]);
    });
    const covered = new Set(windows.flatMap((w) => Array.from({ length: w.core[1] - w.from }, (_, k) => w.from + k)));
    expect(covered.size).toBe(items.length);
  });
  it("um único parágrafo maior que o limite não é cortado nem perdido", () => {
    expect(buildWindows(paragraphs([9000]), 3000, 400)).toEqual([{ from: 0, core: [0, 1] }]);
  });
  it("sem sobreposição quando o limite é zero", () => {
    const windows = buildWindows(paragraphs(Array(10).fill(900)), 2000, 0);
    expect(windows.every((w) => w.from === w.core[0])).toBe(true);
  });
});
