import type { RemoteDocument } from "@/lib/supabase/data-store";
import type { DocumentFormat } from "@/lib/document-types";
import { createClient } from "@/lib/supabase/client";

type ApiFailure = { error?: { code?: string; message?: string } };

async function callApi<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => ({}))) as T & ApiFailure;
  if (!response.ok) throw new Error(payload.error?.message ?? `Falha na requisição (${response.status}).`);
  return payload;
}

type PrepareResponse = { results: Array<{ ok: true; id: string; path: string; token: string } | { ok: false; message: string }> };

const contentTypes: Record<DocumentFormat, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", md: "text/markdown", txt: "text/plain" };

// Fluxo v2: o servidor valida o pedido, o navegador envia por URL assinada e o servidor confere o conteúdo real antes de registrar.
export async function uploadDocumentSecurely(input: { file: File; metadata: Omit<RemoteDocument, "storagePath"> }): Promise<RemoteDocument> {
  const { file, metadata } = input;
  const prepared = await callApi<PrepareResponse>("/api/documents/prepare", { method: "POST", body: JSON.stringify({ files: [{ fileName: file.name, size: file.size, sha256: metadata.sha256 }] }) });
  const target = prepared.results[0];
  if (!target || !target.ok) throw new Error(target?.message ?? "Não foi possível preparar o envio.");
  const upload = await createClient().storage.from("documents").uploadToSignedUrl(target.path, target.token, file, { contentType: contentTypes[metadata.format] });
  if (upload.error) throw new Error(`Não foi possível enviar o original para o armazenamento privado. ${upload.error.message}`);
  const { document } = await callApi<{ document: RemoteDocument }>("/api/documents/finalize", {
    method: "POST",
    body: JSON.stringify({ id: target.id, fileName: file.name, size: file.size, sha256: metadata.sha256, projectId: metadata.projectId, title: metadata.title, extraction: { status: metadata.extractionStatus, extractedText: metadata.extractedText, pageTexts: metadata.pageTexts, pageCount: metadata.pageCount } }),
  });
  return document;
}

export async function openSignedDownload(documentId: string): Promise<void> {
  const { url } = await callApi<{ url: string; expiresInSeconds: number }>(`/api/documents/${encodeURIComponent(documentId)}/download`);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.click();
}
