import "server-only";
import { NextResponse } from "next/server";
import { isPipelineV2Enabled } from "@/lib/feature-flags";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type StageLog = { route: string; stage: string; status: "ok" | "error"; durationMs: number; code?: string };

// Log estruturado sem conteúdo de documentos: apenas rota, estágio, duração e status.
export function logStage(entry: StageLog): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function pipelineDisabledResponse() {
  return jsonError(404, "not_found", "Recurso indisponível.");
}

export async function handleRoute(route: string, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  const started = Date.now();
  if (!isPipelineV2Enabled()) return pipelineDisabledResponse();
  try {
    const response = await handler();
    logStage({ route, stage: "request", status: "ok", durationMs: Date.now() - started });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      logStage({ route, stage: "request", status: "error", durationMs: Date.now() - started, code: error.code });
      return jsonError(error.status, error.code, error.message);
    }
    const detail = error instanceof Error ? error.message : "erro desconhecido";
    console.error(JSON.stringify({ at: new Date().toISOString(), route, stage: "request", status: "error", code: "internal", detail }));
    return jsonError(500, "internal", "Não foi possível concluir a operação. Tente novamente em instantes.");
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // corpo ausente ou JSON inválido: tratado abaixo como requisição inválida
  }
  throw new ApiError(400, "invalid_request", "A requisição está malformada.");
}
