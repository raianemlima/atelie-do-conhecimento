import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { findNoise } from "@/lib/cleaning/noise-verifier";
import { buildExportDocument } from "@/lib/export/build";
import { exportAs } from "@/lib/export";
import { renderMarkdown } from "@/lib/export/markdown";
import { renderPdf } from "@/lib/export/pdf";
import { loadPdfjs } from "@/lib/extraction/pdfjs-loader";
import type { ThemeDraftResult } from "@/lib/drafting/types";
import { makeInput } from "./fixtures";

const AT = new Date("2026-10-21T12:00:00Z");
const norm = (text: string) => text.replace(/\s+/g, " ").trim();

async function pdfPages(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) { const page = await pdf.getPage(n); texts.push(norm((await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" "))); }
  const outline = await pdf.getOutline();
  return { texts, outline, pdf };
}

// Verificador mínimo de XML bem formado (pilha de tags), suficiente para pegar tag aberta ou fechada fora de lugar.
function assertWellFormed(xml: string) {
  const stack: string[] = [];
  for (const match of xml.matchAll(/<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g)) {
    if (match[0].startsWith("<?")) continue;
    if (match[4] === "/") continue;
    if (match[1] === "/") expect(stack.pop()).toBe(match[2]);
    else stack.push(match[2]);
  }
  expect(stack).toEqual([]);
}

describe("representação intermediária", () => {
  const doc = buildExportDocument(makeInput());
  it("numera capítulos e seções e ignora temas ignorados ou sem texto, avisando", () => {
    const sections = doc.parts[0].sections.map((s) => `${s.number} ${s.title}`);
    expect(sections).toEqual(["1 Legitimidade da Defensoria Pública", "1.1 Tutela coletiva e pertinência temática", "1.2 Honorários e prerrogativas", "2 Assistência jurídica integral e gratuita"]);
    expect(doc.warnings).toEqual(['Tema "Tema sem redação" não tem texto redigido e ficou fora da exportação.']);
    expect(doc.stats).toMatchObject({ chapters: 2, sections: 2 });
  });
  it("índice remissivo só tem citações confirmadas pelo registro, com as seções onde aparecem", () => {
    const labels = doc.index.flatMap((group) => group.entries.map((e) => e.label));
    expect(labels).toEqual(expect.arrayContaining(["Súmula 421 do STJ", "REsp 1.234.567/SP"]));
    const sumula = doc.index.find((g) => g.kind === "sumula")!.entries[0];
    expect(sumula.refs).toEqual(["1", "1.1", "1.2", "2"]);
    expect(doc.index.map((g) => g.title)).toEqual(["Legislação", "Súmulas", "Julgados"]);
  });
  it("citação que o registro não confirma não entra no índice", () => {
    const input = makeInput();
    const first = input.parts[0].drafts[0].draft!;
    first.blocks[0].paragraphs.push("Aplica-se a Súmula 999 do STJ ao caso.");
    const labels = buildExportDocument(input).index.flatMap((g) => g.entries.map((e) => e.label));
    expect(labels.join("|")).not.toContain("999");
  });
  it("glossário: ordenado, sem repetir termo igual e avisando definições conflitantes", () => {
    expect(doc.glossary.map((g) => g.term)).toEqual(["Hipossuficiência organizacional", "Pertinência temática"]);
    expect(doc.glossary[1].ref).toBe("1.1");
    const input = makeInput();
    input.parts[0].drafts[3].draft!.glossary = [{ term: "pertinência temática", definition: "Outra definição totalmente diferente." }];
    expect(buildExportDocument(input).warnings.some((w) => w.includes("definições diferentes"))).toBe(true);
  });
  it("várias disciplinas: uma parte por disciplina, numeração contínua", () => {
    const two = buildExportDocument(makeInput(2));
    expect(two.parts.map((p) => p.title)).toEqual(["Direito Constitucional", "Direito Processual Civil"]);
    expect(two.parts[1].sections[0].number).toBe("3");
  });
});

describe("Markdown", () => {
  const md = renderMarkdown(buildExportDocument(makeInput()));
  it("tem sumário com âncoras que existem, capítulos numerados, tabela, índice e glossário", () => {
    const anchors = [...md.matchAll(/\]\(#([\w-]+)\)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(4);
    for (const id of anchors) expect(md).toContain(`<a id="${id}"></a>`);
    expect(md).toContain("### 1. Legitimidade da Defensoria Pública");
    expect(md).toContain("#### 1.1. Tutela coletiva e pertinência temática");
    expect(md).toContain("| Tribunal | Entendimento | Fundamento |");
    expect(md).toContain("## Índice remissivo");
    expect(md).toContain("**Pertinência temática** —");
  });
  it("sem ruído", () => { expect(findNoise(md, {})).toEqual([]); });
});

describe("DOCX", () => {
  it("é um pacote Word válido: partes obrigatórias, XML bem formado, estilos de título e sumário com âncoras existentes", async () => {
    const file = await exportAs(buildExportDocument(makeInput()), "docx", AT);
    expect(file.contentType).toContain("wordprocessingml");
    const zip = await JSZip.loadAsync(file.bytes);
    for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/footer1.xml", "word/_rels/document.xml.rels"]) expect(zip.file(name), name).not.toBeNull();
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".xml") || n.endsWith(".rels"))) assertWellFormed(await zip.file(name)!.async("string"));
    expect((xml.match(/w:val="Heading1"/g) ?? []).length).toBeGreaterThanOrEqual(4); // 2 capítulos + índice + glossário
    expect((xml.match(/w:val="Heading2"/g) ?? []).length).toBe(2);
    const bookmarks = new Set([...xml.matchAll(/w:bookmarkStart w:id="\d+" w:name="([\w-]+)"/g)].map((m) => m[1]));
    const anchors = [...xml.matchAll(/w:anchor="([\w-]+)"/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(4);
    for (const anchor of anchors) expect(bookmarks.has(anchor), anchor).toBe(true);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("w:tblHeader");
    expect(xml).toContain("TOC \\o");
    expect(findNoise(xml.replace(/<[^>]+>/g, " "), {})).toEqual([]);
  });
  it("escapa caracteres especiais do XML e remove controles", async () => {
    const input = makeInput();
    input.parts[0].drafts[0].draft!.blocks[0].paragraphs = ["Texto com <tags> & \"aspas\" e \u0007controle."];
    const zip = await JSZip.loadAsync((await exportAs(buildExportDocument(input), "docx", AT)).bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    assertWellFormed(xml);
    expect(xml).toContain("&lt;tags&gt; &amp; &quot;aspas&quot; e controle.");
  });
});

describe("PDF", () => {
  it("abre, tem capa, sumário com as páginas CERTAS, capítulos em página nova, marcadores, índice e glossário", async () => {
    const doc = buildExportDocument(makeInput());
    const { bytes, pages } = await renderPdf(doc, AT);
    const { texts, outline } = await pdfPages(bytes);
    expect(texts).toHaveLength(pages);
    expect(texts[0]).toContain("Defensoria Pública — Material de Estudo");
    expect(texts[1]).toContain("Sumário");
    // cada linha do sumário aponta para a página onde o título realmente começa
    const tocLines = [...texts[1].matchAll(/(\d+(?:\.\d+)?\. [^.]+?|Índice remissivo|Glossário) \.{3,} (\d+)/g)];
    expect(tocLines.length).toBe(6);
    for (const [, title, page] of tocLines) {
      const at = texts.findIndex((t, i) => i >= 2 && t.startsWith(title.trim()) );
      const heading = title.trim();
      const found = texts.findIndex((t, i) => i >= 2 && t.includes(heading) && (t.indexOf(heading) < 40 || /^\d/.test(heading)));
      expect(Number(page), heading).toBe((at >= 0 ? at : found) + 1);
    }
    for (const chapter of ["1. Legitimidade da Defensoria Pública", "2. Assistência jurídica integral e gratuita"]) expect(texts.some((t, i) => i >= 2 && t.startsWith(chapter))).toBe(true);
    expect(norm(outline?.map((o) => o.title).join("|") ?? "")).toContain("1. Legitimidade da Defensoria Pública");
    expect(outline?.[0].items.map((i) => i.title)).toEqual(["1.1. Tutela coletiva e pertinência temática", "1.2. Honorários e prerrogativas"]);
    expect(texts.join(" ")).toContain("Índice remissivo");
    expect(texts.join(" ")).toContain("Glossário");
    expect(texts.join(" ")).toContain("Súmula 421 do STJ — 1, 1.1, 1.2, 2");
  });
  it("não perde texto na paginação: parágrafo gigante, tabela com linha enorme e títulos nunca sozinhos no fim da página", async () => {
    const input = makeInput();
    const draft = input.parts[0].drafts[0].draft!;
    const marker = "FIM-DO-PARAGRAFO-GIGANTE";
    draft.blocks[1].paragraphs = [`${"Texto corrido de teste para paginação. ".repeat(260)}${marker}`];
    draft.blocks[2].table!.rows.push(["X", `${"célula longa ".repeat(500)}FIM-DA-CELULA`, "Y"]);
    const { bytes } = await renderPdf(buildExportDocument(input), AT);
    const { texts } = await pdfPages(bytes);
    const all = texts.join(" ");
    expect(all).toContain(marker);
    expect(all).toContain("FIM-DA-CELULA");
    // a linha gigante atravessa várias páginas e o cabeçalho da tabela é repetido em TODAS elas
    const withGiantCell = texts.filter((t) => t.includes("célula longa"));
    expect(withGiantCell.length).toBeGreaterThan(2);
    for (const t of withGiantCell) expect(t).toContain("Tribunal Entendimento Fundamento");
    // título de seção/subtítulo nunca é a última coisa da página
    for (const t of texts.slice(2)) expect(/(Introdução|Desenvolvimento|Quadro comparativo|Pontos de atenção)\s*\d*$/.test(t.replace(/\s\d+$/, "").trim())).toBe(false);
  });
  it("caracteres fora do alfabeto do PDF são substituídos E avisados (nunca em silêncio)", async () => {
    const input = makeInput();
    input.parts[0].drafts[0].draft!.blocks[0].paragraphs = ["Seta → e símbolo ☃ no texto, além de espaço rígido."];
    const result = await renderPdf(buildExportDocument(input), AT);
    expect(result.warnings.some((w) => w.includes("caractere(s) fora do alfabeto"))).toBe(true);
    const { texts } = await pdfPages(result.bytes);
    expect(texts.join(" ")).toContain("Seta -> e símbolo ? no texto");
  });
  it("duas disciplinas: sumário lista as disciplinas e a numeração continua", async () => {
    const { bytes } = await renderPdf(buildExportDocument(makeInput(2)), AT);
    const { texts } = await pdfPages(bytes);
    expect(texts[1]).toContain("Direito Constitucional");
    expect(texts[1]).toContain("Direito Processual Civil");
    expect(texts[1]).toContain("3. Legitimidade da Defensoria Pública");
  });
  it("sem ruído no texto exportado", async () => {
    const { bytes } = await renderPdf(buildExportDocument(makeInput()), AT);
    const { texts } = await pdfPages(bytes);
    expect(findNoise(texts.slice(2).join("\n"), {})).toEqual([]);
  });
});

describe("determinismo", () => {
  it("mesma entrada e mesma data geram arquivos idênticos nos três formatos", async () => {
    const doc = buildExportDocument(makeInput());
    for (const format of ["md", "docx", "pdf"] as const) {
      const a = await exportAs(doc, format, AT), b = await exportAs(doc, format, AT);
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)), format).toBe(true);
    }
  });
  it("sem nenhum tema redigido ainda produz arquivos válidos (com avisos)", async () => {
    const input = makeInput();
    input.parts[0].drafts = [];
    const doc = buildExportDocument(input);
    expect(doc.parts[0].sections).toEqual([]);
    expect(doc.warnings.length).toBeGreaterThan(0);
    for (const format of ["md", "docx", "pdf"] as const) expect((await exportAs(doc, format, AT)).bytes.length).toBeGreaterThan(100);
  });
  it("tema sem draft válido (falha) é tratado como sem texto", () => {
    const input = makeInput();
    input.parts[0].drafts[3] = { ...(input.parts[0].drafts[3] as ThemeDraftResult), draft: null };
    expect(buildExportDocument(input).warnings.some((w) => w.includes("Assistência"))).toBe(true);
  });
});
