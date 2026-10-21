import "server-only";
import type { DocumentFormat, ExtractionStatus } from "@/lib/document-types";
import type { RemoteDocument } from "@/lib/supabase/data-store";

export const SIGNED_URL_TTL_SECONDS = 60;
export const MAX_EXTRACTED_CHARS = 5_000_000;
export const MAX_PAGE_COUNT = 5000;
const STATUSES: readonly ExtractionStatus[] = ["text", "no-text", "failed"];
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DocumentRow = {
  id: string; title: string; file_name: string; format: DocumentFormat; size: number; imported_at: string;
  project_id: string | null; sha256: string; extraction_status: ExtractionStatus; extracted_text: string;
  page_texts: string[] | null; page_count: number; storage_path: string;
};

export function toRemoteDocument(row: DocumentRow): RemoteDocument {
  return { id: row.id, title: row.title, fileName: row.file_name, format: row.format, size: Number(row.size), importedAt: row.imported_at, projectId: row.project_id, sha256: row.sha256, extractionStatus: row.extraction_status, extractedText: row.extracted_text, pageTexts: row.page_texts ?? [], pageCount: row.page_count, storagePath: row.storage_path };
}

export type ExtractionPayload = { status: ExtractionStatus; extractedText: string; pageTexts: string[]; pageCount: number };

export function parseExtraction(value: unknown): ExtractionPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const { status, extractedText, pageTexts, pageCount } = input;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return null;
  if (typeof extractedText !== "string" || extractedText.length > MAX_EXTRACTED_CHARS) return null;
  if (!Array.isArray(pageTexts) || pageTexts.length > MAX_PAGE_COUNT || !pageTexts.every((page) => typeof page === "string")) return null;
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 0 || pageCount > MAX_PAGE_COUNT) return null;
  return { status: status as ExtractionStatus, extractedText, pageTexts: pageTexts as string[], pageCount };
}
