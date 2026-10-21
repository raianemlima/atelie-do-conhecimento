import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { exportAs } from "@/lib/export";
import { buildExportDocument } from "@/lib/export/build";
import { partFromStages, type ExportPartData } from "@/lib/export/from-stages";
import { type ExportFormat } from "@/lib/export/types";
import { SupabasePipelineRepository, toJob } from "@/lib/pipeline/supabase-repository";
import { ApiError } from "@/lib/server/http";
import { loadNotebook } from "@/lib/server/pipeline";

export function parseFormat(value: string | null): ExportFormat {
  if (value === "pdf" || value === "docx" || value === "md") return value;
  throw new ApiError(400, "invalid_request", "Formato inválido. Use pdf, docx ou md.");
}

// Apostila verificada mais recente do caderno (job concluído cuja verificação passou).
export async function loadLatestPart(supabase: SupabaseClient, notebookId: string): Promise<(ExportPartData & { name: string }) | null> {
  const { data, error } = await supabase.from("jobs").select("*").eq("notebook_id", notebookId).eq("status", "succeeded").order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(`Falha ao listar jobs: ${error.message}`);
  const repo = new SupabasePipelineRepository(supabase);
  for (const row of (data ?? []) as Parameters<typeof toJob>[0][]) {
    const part = partFromStages(await repo.listStages(toJob(row).id));
    if (part) return { ...part, name: (await loadNotebook(supabase, notebookId))?.name ?? "Apostila" };
  }
  return null;
}

export async function exportResponse(title: string, parts: ExportPartData[], format: ExportFormat): Promise<NextResponse> {
  const file = await exportAs(buildExportDocument({ title, parts }), format);
  const disposition = `attachment; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
  return new NextResponse(file.bytes as BodyInit, { headers: { "Content-Type": file.contentType, "Content-Disposition": disposition, "Cache-Control": "private, no-store", ...(file.warnings.length ? { "X-Export-Warnings": String(file.warnings.length) } : {}) } });
}
