import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { DocumentFormat } from "@/lib/document-types";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BATCH = 20;
export const MAX_FILE_NAME_LENGTH = 180;
const FORMATS: readonly DocumentFormat[] = ["pdf", "docx", "md", "txt"];

export type UploadErrorCode =
  | "invalid_name" | "unsupported_format" | "empty" | "too_large" | "too_many"
  | "format_mismatch" | "truncated" | "corrupted" | "size_mismatch" | "hash_mismatch" | "duplicate" | "invalid_request";

export type UploadRuleResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; code: UploadErrorCode; message: string };

const fail = (code: UploadErrorCode, message: string): { ok: false; code: UploadErrorCode; message: string } => ({ ok: false, code, message });

export function isDocumentFormat(value: unknown): value is DocumentFormat {
  return typeof value === "string" && (FORMATS as readonly string[]).includes(value);
}

export function validateFileName(fileName: unknown): UploadRuleResult<{ format: DocumentFormat }> {
  if (typeof fileName !== "string" || !fileName.trim()) return fail("invalid_name", "O nome do arquivo está vazio. Renomeie o arquivo e tente novamente.");
  if (fileName.length > MAX_FILE_NAME_LENGTH) return fail("invalid_name", `O nome do arquivo excede ${MAX_FILE_NAME_LENGTH} caracteres. Use um nome mais curto.`);
  if (/[\u0000-\u001f\u007f/\\]/.test(fileName) || fileName.includes("..")) return fail("invalid_name", "O nome do arquivo contém caracteres não permitidos (barras, '..' ou caracteres de controle). Renomeie o arquivo.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (!isDocumentFormat(extension)) return fail("unsupported_format", "Formato não suportado. Envie PDF, DOCX, Markdown (.md) ou TXT.");
  return { ok: true, format: extension };
}

export function validateDeclaredSize(size: unknown): UploadRuleResult<{ size: number }> {
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return fail("invalid_request", "O tamanho informado do arquivo é inválido.");
  if (size === 0) return fail("empty", "O arquivo está vazio e não pode ser importado.");
  if (size > MAX_UPLOAD_BYTES) return fail("too_large", "O arquivo excede o limite de 25 MB. Divida-o em partes menores.");
  return { ok: true, size };
}

export function validateBatchSize(count: number): UploadRuleResult {
  if (!Number.isInteger(count) || count < 1) return fail("invalid_request", "Nenhum arquivo foi informado.");
  if (count > MAX_UPLOAD_BATCH) return fail("too_many", `Selecione no máximo ${MAX_UPLOAD_BATCH} arquivos por lote.`);
  return { ok: true };
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function storageFileName(name: string): string {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "documento";
}

export function buildStoragePath(userId: string, documentId: string, fileName: string): string {
  return `${userId}/${documentId}/${storageFileName(fileName)}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const startsWith = (bytes: Uint8Array, signature: string) => signature.split("").every((char, index) => bytes[index] === char.charCodeAt(0));

async function isTextual(bytes: Uint8Array): Promise<boolean> {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

// Confere o conteúdo REAL do arquivo, ignorando extensão e Content-Type declarados pelo cliente.
export async function inspectContent(bytes: Uint8Array, declared: DocumentFormat): Promise<UploadRuleResult> {
  if (declared === "pdf") {
    if (!startsWith(bytes, "%PDF-")) return fail("format_mismatch", "O conteúdo do arquivo não é um PDF. Verifique se ele não foi renomeado.");
    const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
    if (!tail.includes("%%EOF")) return fail("truncated", "O PDF parece incompleto ou corrompido (fim do arquivo ausente). Baixe-o novamente e reenvie.");
    return { ok: true };
  }
  if (declared === "docx") {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return fail("format_mismatch", "O conteúdo do arquivo não é um DOCX. Verifique se ele não foi renomeado.");
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (!zip.file("word/document.xml")) return fail("corrupted", "O DOCX não contém o documento principal. Abra e salve novamente no Word.");
      return { ok: true };
    } catch {
      return fail("corrupted", "O DOCX está corrompido e não pôde ser aberto. Reexporte o arquivo e tente novamente.");
    }
  }
  return (await isTextual(bytes)) ? { ok: true } : fail("format_mismatch", "O arquivo não é um texto UTF-8 válido. Salve-o como UTF-8 e reenvie.");
}

export type DeclaredUpload = { fileName: string; format: DocumentFormat; size: number; sha256: string };

export async function verifyUploadedObject(declared: DeclaredUpload, bytes: Uint8Array): Promise<UploadRuleResult<{ sha256: string; size: number }>> {
  if (bytes.length !== declared.size) return fail("size_mismatch", "O tamanho do arquivo enviado difere do informado. Reenvie o arquivo.");
  if (bytes.length > MAX_UPLOAD_BYTES) return fail("too_large", "O arquivo excede o limite de 25 MB.");
  const content = await inspectContent(bytes, declared.format);
  if (!content.ok) return content;
  const actual = sha256Hex(bytes);
  if (actual !== declared.sha256) return fail("hash_mismatch", "A impressão digital do arquivo enviado difere da informada. Reenvie o arquivo.");
  return { ok: true, sha256: actual, size: bytes.length };
}
