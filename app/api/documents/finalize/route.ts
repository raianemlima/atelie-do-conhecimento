import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { toRemoteDocument, parseExtraction, UUID_PATTERN, type DocumentRow } from "@/lib/server/documents";
import { ApiError, handleRoute, readJson } from "@/lib/server/http";
import { buildStoragePath, isSha256, validateDeclaredSize, validateFileName, verifyUploadedObject } from "@/lib/server/upload-rules";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleRoute("documents.finalize", async () => {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const id = body.id;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Identificador do documento inválido.");
    const name = validateFileName(body.fileName);
    if (!name.ok) throw new ApiError(422, name.code, name.message);
    const size = validateDeclaredSize(body.size);
    if (!size.ok) throw new ApiError(422, size.code, size.message);
    if (!isSha256(body.sha256)) throw new ApiError(400, "invalid_request", "A impressão digital (SHA-256) do arquivo é inválida.");
    const extraction = parseExtraction(body.extraction);
    if (!extraction) throw new ApiError(400, "invalid_request", "Os dados de extração do documento são inválidos.");
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 300) : body.fileName as string;
    const projectId = typeof body.projectId === "string" && UUID_PATTERN.test(body.projectId) ? body.projectId : null;

    const path = buildStoragePath(user.id, id, body.fileName as string);
    const storage = supabase.storage.from("documents");
    const { data: blob, error: downloadError } = await storage.download(path);
    if (downloadError || !blob) throw new ApiError(409, "upload_missing", "O arquivo enviado não foi encontrado. Reenvie o documento.");

    const checked = await verifyUploadedObject({ fileName: body.fileName as string, format: name.format, size: size.size, sha256: body.sha256 }, new Uint8Array(await blob.arrayBuffer()));
    if (!checked.ok) {
      const { error: removeError } = await storage.remove([path]);
      if (removeError) console.error(JSON.stringify({ route: "documents.finalize", stage: "cleanup", status: "error", detail: removeError.message }));
      throw new ApiError(422, checked.code, checked.message);
    }

    const row = { id, project_id: projectId, title, file_name: body.fileName, format: name.format, size: checked.size, imported_at: new Date().toISOString(), sha256: checked.sha256, extraction_status: extraction.status, extracted_text: extraction.extractedText, page_texts: extraction.pageTexts, page_count: extraction.pageCount, storage_path: path };
    const { data, error } = await supabase.from("documents").insert(row).select("*").single();
    if (error) {
      await storage.remove([path]);
      if (error.code === "23505") throw new ApiError(409, "duplicate", "Este arquivo já está na biblioteca.");
      throw new Error(`Falha ao salvar metadados do documento: ${error.message}`);
    }
    return NextResponse.json({ document: toRemoteDocument(data as DocumentRow) });
  });
}
