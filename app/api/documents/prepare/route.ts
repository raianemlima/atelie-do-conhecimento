import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { ApiError, handleRoute, readJson } from "@/lib/server/http";
import { buildStoragePath, isSha256, validateBatchSize, validateDeclaredSize, validateFileName, type UploadErrorCode } from "@/lib/server/upload-rules";

export const dynamic = "force-dynamic";

type PrepareResult =
  | { ok: true; fileName: string; id: string; path: string; token: string; signedUrl: string }
  | { ok: false; fileName: string; code: UploadErrorCode; message: string };

export function POST(request: Request) {
  return handleRoute("documents.prepare", async () => {
    const { supabase, user } = await requireUser();
    const body = await readJson(request);
    const files = Array.isArray(body.files) ? (body.files as Record<string, unknown>[]) : [];
    const batch = validateBatchSize(files.length);
    if (!batch.ok) throw new ApiError(400, batch.code, batch.message);

    const hashes = files.map((file) => (isSha256(file.sha256) ? file.sha256 : null)).filter((hash): hash is string => hash !== null);
    const { data: existing, error: lookupError } = await supabase.from("documents").select("sha256").in("sha256", hashes);
    if (lookupError) throw new Error(`Falha ao consultar duplicatas: ${lookupError.message}`);
    const knownHashes = new Set((existing ?? []).map((row: { sha256: string }) => row.sha256));

    const results: PrepareResult[] = [];
    for (const file of files) {
      const fileName = typeof file.fileName === "string" ? file.fileName : "";
      const name = validateFileName(file.fileName);
      if (!name.ok) { results.push({ ok: false, fileName, code: name.code, message: name.message }); continue; }
      const size = validateDeclaredSize(file.size);
      if (!size.ok) { results.push({ ok: false, fileName, code: size.code, message: size.message }); continue; }
      if (!isSha256(file.sha256)) { results.push({ ok: false, fileName, code: "invalid_request", message: "A impressão digital (SHA-256) do arquivo é inválida." }); continue; }
      if (knownHashes.has(file.sha256)) { results.push({ ok: false, fileName, code: "duplicate", message: "Este arquivo já está na biblioteca." }); continue; }
      knownHashes.add(file.sha256);
      const id = crypto.randomUUID();
      const path = buildStoragePath(user.id, id, fileName);
      const { data, error } = await supabase.storage.from("documents").createSignedUploadUrl(path);
      if (error || !data) throw new Error(`Falha ao preparar o envio: ${error?.message ?? "resposta vazia"}`);
      results.push({ ok: true, fileName, id, path, token: data.token, signedUrl: data.signedUrl });
    }
    return NextResponse.json({ results });
  });
}
