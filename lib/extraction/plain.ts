import JSZip from "jszip";
import { collapseSpaces, joinLines } from "@/lib/extraction/text-utils";
import { ExtractionError, type DocumentExtraction, type LayoutBlock } from "@/lib/extraction/types";

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&amp;/g, "&");
}

function paragraphsToBlocks(paragraphs: string[], kind: "body" | "table" = "body"): LayoutBlock[] {
  return paragraphs.map((text, index) => ({ kind, text, fontSize: 0, y: -index, column: null, heading: /^#{1,6}\s/.test(text), source: "text-layer" as const })).filter((block) => block.text);
}

export function extractText(format: "md" | "txt", bytes: Uint8Array): DocumentExtraction {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ExtractionError("corrupted", "O arquivo não é um texto UTF-8 válido. Salve-o como UTF-8 e reenvie."); }
  const paragraphs = text.replace(/^﻿/, "").split(/\r?\n\s*\n/).map((part) => joinLines(part.split(/\r?\n/))).filter(Boolean);
  return plainResult(format, paragraphsToBlocks(paragraphs));
}

export async function extractDocx(bytes: Uint8Array): Promise<DocumentExtraction> {
  let xml: string | undefined;
  try { xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")?.async("text"); }
  catch { throw new ExtractionError("corrupted", "O DOCX está corrompido e não pôde ser aberto. Reexporte o arquivo e tente novamente."); }
  if (!xml) throw new ExtractionError("corrupted", "O DOCX não contém o documento principal. Abra e salve novamente no Word.");
  const blocks: LayoutBlock[] = [];
  const tables = xml.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/);
  for (const part of tables) {
    const textOf = (fragment: string) => collapseSpaces(decodeXml(fragment.replace(/<w:tab\s*\/>/g, " ").replace(/<w:br\s*\/>/g, " ").replace(/<[^>]+>/g, "")));
    if (part.startsWith("<w:tbl>")) {
      const rows = (part.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((row) => (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(textOf).join(" | "));
      blocks.push(...paragraphsToBlocks([rows.filter(Boolean).join("\n")], "table"));
    } else {
      blocks.push(...paragraphsToBlocks((part.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(textOf)));
    }
  }
  return plainResult("docx", blocks);
}

function plainResult(format: "docx" | "md" | "txt", blocks: LayoutBlock[]): DocumentExtraction {
  const charCount = blocks.reduce((total, block) => total + block.text.replace(/\s/g, "").length, 0);
  const page = { page: 1, width: 0, height: 0, blocks, charCount, hasTextLayer: charCount > 0, hasImages: false, blank: charCount === 0, needsOcr: false, ocr: "not-needed" as const };
  return { format, status: charCount > 0 ? "text" : "no-text", pageCount: 1, pages: [page], warnings: [] };
}
