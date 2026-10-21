import type { DocumentFormat, ExtractionStatus } from "@/lib/document-types";
import JSZip from "jszip";
import { cleanDocumentText } from "@/lib/text-cleaner";

export type ExtractionResult = {
  extractedText: string;
  pageTexts: string[];
  pageCount: number;
  status: ExtractionStatus;
};

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer).replace(/^\uFEFF/, "");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

async function extractDocx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) return { extractedText: "", pageTexts: [""], pageCount: 1, status: "failed" };
  const xml = await entry.async("text");
  const rawText = xml
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => decodeXmlEntities(entity))
    .replace(/\n{3,}/g, "\n\n").trim();
  const text = cleanDocumentText(rawText);
  return { extractedText: text, pageTexts: [text], pageCount: 1, status: text ? "text" : "no-text" };
}

async function extractPdf(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    // Mantém o worker dentro do bundle local; nenhum PDF é enviado para a rede.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; text: string }[]>();
    content.items.forEach((item) => {
      if (!("str" in item) || !item.str.trim()) return;
      const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : null;
      const x = transform?.[4] ?? 0;
      const y = transform?.[5] ?? 0;
      const lineKey = Math.round(y / 2) * 2;
      const line = lines.get(lineKey) ?? [];
      line.push({ x, text: item.str });
      lines.set(lineKey, line);
    });
    const rawPageText = [...lines.entries()]
      .sort(([first], [second]) => second - first)
      .map(([, line]) => line.sort((first, second) => first.x - second.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const pageText = cleanDocumentText(rawPageText);
    pageTexts.push(pageText);
    page.cleanup();
  }

  await loadingTask.destroy();
  const extractedText = cleanDocumentText(pageTexts.join("\n\n"), pageTexts);
  return { extractedText, pageTexts, pageCount, status: extractedText ? "text" : "no-text" };
}

export async function extractDocumentText(file: Blob, format: DocumentFormat): Promise<ExtractionResult> {
  if (format === "pdf") return extractPdf(await file.arrayBuffer());
  if (format === "docx") return extractDocx(await file.arrayBuffer());
  const extractedText = cleanDocumentText(decodeText(await file.arrayBuffer()));
  return { extractedText, pageTexts: [extractedText], pageCount: 1, status: extractedText.trim() ? "text" : "no-text" };
}
