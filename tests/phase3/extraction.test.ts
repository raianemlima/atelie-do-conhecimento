import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { extractOriginal, ExtractionError, type OcrProvider } from "@/lib/extraction";
import { joinLines } from "@/lib/extraction/text-utils";
import { CORPUS_DIR } from "../helpers";

const pdf = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const kinds = (result: Awaited<ReturnType<typeof extractOriginal>>, page = 0) => result.pages[page].blocks.map((block) => block.kind);
const texts = (result: Awaited<ReturnType<typeof extractOriginal>>, page = 0) => result.pages[page].blocks.map((block) => block.text);

describe("ordem de leitura, colunas, tabelas e notas de rodapé", () => {
  it("duas colunas: título em largura total, coluna esquerda inteira e só depois a direita", async () => {
    const result = await extractOriginal("pdf", pdf("09-duas-colunas.pdf"));
    expect(result.pages[0].blocks.map((block) => block.column)).toEqual([null, 0, 0, 1, 1]);
    const [title, left1, left2, right1, right2] = texts(result);
    expect(result.pages[0].blocks[0].heading).toBe(true);
    expect(title).toBe("PRINCIPIOS DA DEFENSORIA PUBLICA");
    expect(left1).toMatch(/^COLUNA ESQUERDA PRIMEIRO\. A unidade impoe .* como um todo\.$/);
    expect(left2).toMatch(/^A indivisibilidade .* ao assistido\.$/);
    expect(right1).toMatch(/^COLUNA DIREITA DEPOIS\. A independencia/);
    expect(right2).toMatch(/garantia institucional\.$/);
    expect(left1).not.toMatch(/COLUNA DIREITA/);
  });
  it("tabela: linhas preservadas com células separadas, parágrafos antes e depois intactos", async () => {
    const result = await extractOriginal("pdf", pdf("10-tabela.pdf"));
    expect(kinds(result)).toEqual(["body", "table", "body"]);
    expect(texts(result)[1].split("\n")).toEqual(["Corrente | Posicao | Fundamento", "Ampla | Admite | Art. 134 CF", "Restrita | Nega | Hipossuficiencia", "Intermediaria | Admite parcial | Tutela coletiva"]);
    expect(texts(result)[0]).toMatch(/conforme o quadro\.$/);
    expect(texts(result)[2]).toMatch(/^Apos o quadro, o texto retoma/);
  });
  it("notas de rodapé ficam separadas do corpo; cabeçalho e rodapé são zonas próprias", async () => {
    const result = await extractOriginal("pdf", pdf("11-notas-de-rodape.pdf"));
    expect(result.pageCount).toBe(3);
    for (let page = 0; page < 3; page += 1) {
      expect(kinds(result, page)).toEqual(["header", "body", "footnote", "footer"]);
      expect(texts(result, page)[2]).toMatch(/^\d Nota de rodape:/);
      expect(texts(result, page)[1]).not.toMatch(/Nota de rodape/);
      expect(texts(result, page)[3]).toBe(String(page + 1));
    }
  });
  it("parágrafo contínuo vira um único bloco e a hifenização partida é refeita", async () => {
    const result = await extractOriginal("pdf", pdf("04-ruidoso.pdf"));
    const body = result.pages[0].blocks.find((block) => block.kind === "body");
    expect(body?.text).toContain("insuficiência de recursos");
    expect(body?.text).not.toMatch(/-\s/);
    expect(body?.text.includes("\n")).toBe(false);
  });
  it("joinLines só remove o hífen quando a linha seguinte continua em minúscula", () => {
    expect(joinLines(["responsabili-", "dade civil"])).toBe("responsabilidade civil");
    expect(joinLines(["norte-", "Americano"])).toBe("norte- Americano");
    expect(joinLines(["linha um", "linha dois"])).toBe("linha um linha dois");
  });
});

describe("páginas sem camada de texto e OCR", () => {
  it("PDF totalmente digitalizado: no-text, página marcada e aviso explícito (sem simular leitura)", async () => {
    const result = await extractOriginal("pdf", pdf("06-digitalizado.pdf"));
    expect(result.status).toBe("no-text");
    expect(result.pages[0]).toMatchObject({ hasTextLayer: false, hasImages: true, blank: false, needsOcr: true, ocr: "unavailable", charCount: 0 });
    expect(result.warnings).toEqual([expect.objectContaining({ code: "ocr_unavailable", pages: [1] })]);
  });
  it("PDF misto: só a página 2 precisa de OCR; as outras seguem com texto (status partial)", async () => {
    const result = await extractOriginal("pdf", pdf("12-misto.pdf"));
    expect(result.status).toBe("partial");
    expect(result.pages.map((page) => page.needsOcr)).toEqual([false, true, false]);
    expect(result.pages.map((page) => page.hasTextLayer)).toEqual([true, false, true]);
    expect(result.warnings[0]).toMatchObject({ code: "ocr_unavailable", pages: [2] });
  });
  it("com provedor de OCR: roda SOMENTE nas páginas sem texto e marca a origem do texto", async () => {
    const recognize = vi.fn(async () => ({ 2: "Texto reconhecido por OCR.\n\nSegundo bloco reconhecido." }));
    const ocr: OcrProvider = { id: "fake-ocr", recognize };
    const result = await extractOriginal("pdf", pdf("12-misto.pdf"), { ocr });
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ pages: [2] }));
    expect(result.status).toBe("text");
    expect(result.warnings).toEqual([]);
    expect(result.pages[1]).toMatchObject({ ocr: "done", needsOcr: false });
    expect(result.pages[1].blocks.map((block) => [block.source, block.text])).toEqual([["ocr", "Texto reconhecido por OCR."], ["ocr", "Segundo bloco reconhecido."]]);
    expect(result.pages[0].blocks.every((block) => block.source === "text-layer")).toBe(true);
  });
  it("PDF 100% com texto nunca aciona o OCR", async () => {
    const recognize = vi.fn(async () => ({}));
    await extractOriginal("pdf", pdf("01-texto-simples.pdf"), { ocr: { id: "x", recognize } });
    expect(recognize).not.toHaveBeenCalled();
  });
  it("falha do OCR não derruba a extração: vira aviso e as páginas seguem sem texto", async () => {
    const result = await extractOriginal("pdf", pdf("12-misto.pdf"), { ocr: { id: "x", recognize: async () => { throw new Error("serviço fora do ar"); } } });
    expect(result.status).toBe("partial");
    expect(result.warnings).toEqual([expect.objectContaining({ code: "ocr_failed", pages: [2], message: expect.stringContaining("serviço fora do ar") })]);
  });
  it("OCR que devolve vazio para a página mantém a página pendente (não inventa texto)", async () => {
    const result = await extractOriginal("pdf", pdf("12-misto.pdf"), { ocr: { id: "x", recognize: async () => ({ 2: "   " }) } });
    expect(result.pages[1]).toMatchObject({ ocr: "unavailable", needsOcr: true });
  });
});

describe("arquivos inválidos: erro claro e acionável", () => {
  it("PDF corrompido", async () => {
    const error = await extractOriginal("pdf", pdf("07-corrompido.pdf")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toMatchObject({ code: "corrupted", message: expect.stringMatching(/corrompido ou incompleto.*reenvie/i) });
  });
  it("PDF protegido por senha", async () => {
    const error = await extractOriginal("pdf", pdf("08-protegido.pdf")).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "password_protected", message: expect.stringMatching(/protegido por senha.*reenvie/i) });
  });
  it("bytes que não são PDF", async () => {
    await expect(extractOriginal("pdf", new TextEncoder().encode("não sou um pdf"))).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe("DOCX, Markdown e TXT", () => {
  async function docx(body: string) {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body>${body}</w:body></w:document>`);
    return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  }
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
  it("DOCX: parágrafos, entidades XML e tabela preservada com células", async () => {
    const result = await extractOriginal("docx", await docx(`${p("Primeiro &amp; segundo")}<w:tbl><w:tr>${cell("A")}${cell("B")}</w:tr><w:tr>${cell("C")}${cell("D")}</w:tr></w:tbl>${p("Fim")}`));
    expect(result.pages[0].blocks.map((block) => [block.kind, block.text])).toEqual([["body", "Primeiro & segundo"], ["table", "A | B\nC | D"], ["body", "Fim"]]);
    expect(result.status).toBe("text");
  });
  it("DOCX inválido gera erro claro", async () => {
    await expect(extractOriginal("docx", new TextEncoder().encode("PK não é zip"))).rejects.toMatchObject({ code: "corrupted" });
  });
  it("Markdown/TXT: parágrafos por linha em branco, linhas internas unidas; UTF-8 inválido é rejeitado", async () => {
    const result = await extractOriginal("md", new TextEncoder().encode("# Título\n\nlinha um\nlinha dois\n\nÚltimo."));
    expect(result.pages[0].blocks.map((block) => block.text)).toEqual(["# Título", "linha um linha dois", "Último."]);
    expect(result.pages[0].blocks[0].heading).toBe(true);
    await expect(extractOriginal("txt", new Uint8Array([0xff, 0xfe, 0xfd]))).rejects.toMatchObject({ code: "corrupted" });
  });
});
