import { extractDocx, extractText } from "@/lib/extraction/plain";
import { extractPdf } from "@/lib/extraction/pdf";
import type { DocumentExtraction, ExtractOptions } from "@/lib/extraction/types";

export type { DocumentExtraction, ExtractedPage, LayoutBlock, OcrProvider, ExtractOptions } from "@/lib/extraction/types";
export { ExtractionError } from "@/lib/extraction/types";

export async function extractOriginal(format: "pdf" | "docx" | "md" | "txt", bytes: Uint8Array, options: ExtractOptions = {}): Promise<DocumentExtraction> {
  if (format === "pdf") return extractPdf(bytes, options);
  if (format === "docx") return extractDocx(bytes);
  return extractText(format, bytes);
}
