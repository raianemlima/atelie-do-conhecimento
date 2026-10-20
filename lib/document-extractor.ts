import type { DocumentFormat, ExtractionStatus } from "@/lib/document-types";

export type ExtractionResult = {
  extractedText: string;
  pageTexts: string[];
  pageCount: number;
  status: ExtractionStatus;
};

function decodeText(buffer: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer).replace(/^\uFEFF/, "");
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
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push(pageText);
    page.cleanup();
  }

  await loadingTask.destroy();
  const extractedText = pageTexts.map((text, index) => `\n[ Página ${index + 1} ]\n${text}`).join("\n").trim();
  return { extractedText, pageTexts, pageCount, status: extractedText ? "text" : "no-text" };
}

export async function extractDocumentText(file: Blob, format: DocumentFormat): Promise<ExtractionResult> {
  if (format === "pdf") return extractPdf(await file.arrayBuffer());
  const extractedText = decodeText(await file.arrayBuffer());
  return { extractedText, pageTexts: [extractedText], pageCount: 1, status: extractedText.trim() ? "text" : "no-text" };
}
