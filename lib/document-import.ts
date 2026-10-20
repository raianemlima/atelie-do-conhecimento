import type { DocumentFormat } from "@/lib/document-types";

export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
export const ACCEPTED_DOCUMENTS = ".pdf,.md,.txt";

export type ImportErrorCode = "format" | "empty" | "large" | "duplicate" | "read";

export class DocumentImportError extends Error {
  code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "DocumentImportError";
    this.code = code;
  }
}

export function getDocumentFormat(file: File): DocumentFormat | null {
  const extension = file.name.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "md" || extension === "txt" ? extension : null;
}

export function validateDocumentFile(file: File): DocumentFormat {
  const format = getDocumentFormat(file);
  if (!format) throw new DocumentImportError("format", "Formato não suportado. Importe apenas PDF, Markdown (.md) ou TXT.");
  if (file.size === 0) throw new DocumentImportError("empty", "O arquivo está vazio e não pode ser importado.");
  if (file.size > MAX_DOCUMENT_SIZE) throw new DocumentImportError("large", "O arquivo excede o limite local de 25 MB.");
  return format;
}

export async function fingerprintFile(file: File) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new DocumentImportError("read", "Não foi possível calcular a impressão digital do arquivo.");
  }
}

export function ensureNotDuplicate(hash: string, existingHashes: string[]) {
  if (existingHashes.includes(hash)) throw new DocumentImportError("duplicate", "Este arquivo já está na biblioteca.");
}
