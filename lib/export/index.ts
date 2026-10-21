import { renderDocx } from "@/lib/export/docx";
import { renderMarkdown } from "@/lib/export/markdown";
import { renderPdf } from "@/lib/export/pdf";
import { FORMAT_CONTENT_TYPES, type ExportDocument, type ExportFormat, type ExportedFile } from "@/lib/export/types";

const slug = (title: string) => title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "apostila";

export async function exportAs(doc: ExportDocument, format: ExportFormat, generatedAt: Date = new Date()): Promise<ExportedFile & { warnings: string[] }> {
  const fileName = `${slug(doc.title)}.${format}`;
  if (format === "md") return { format, fileName, contentType: FORMAT_CONTENT_TYPES.md, bytes: new TextEncoder().encode(renderMarkdown(doc)), warnings: doc.warnings };
  if (format === "docx") return { format, fileName, contentType: FORMAT_CONTENT_TYPES.docx, bytes: await renderDocx(doc, generatedAt), warnings: doc.warnings };
  const pdf = await renderPdf(doc, generatedAt);
  return { format, fileName, contentType: FORMAT_CONTENT_TYPES.pdf, bytes: pdf.bytes, warnings: pdf.warnings };
}
