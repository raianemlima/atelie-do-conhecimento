import type { MapOperation } from "@/lib/thematic/operations";
import type { MapVersion, MapVersionSummary } from "@/lib/thematic/store";

export type MapResponse = { latest: MapVersion; versions: MapVersionSummary[] };
type ApiFailure = { error?: { code?: string; message?: string } };

async function call<T>(input: string, init?: RequestInit): Promise<{ status: number; body: T & ApiFailure }> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as T & ApiFailure };
}

function ensure<T>(result: { status: number; body: T & ApiFailure }): T {
  if (result.status >= 400) throw new Error(result.body.error?.message ?? `Falha na requisição (${result.status}).`);
  return result.body;
}

export async function getMap(notebookId: string): Promise<MapResponse | null> {
  const result = await call<MapResponse>(`/api/notebooks/${encodeURIComponent(notebookId)}/map`);
  return result.status === 404 ? null : ensure(result);
}

// Operações de edição não levam data: quem define é o servidor.
export type ClientOperation = Exclude<MapOperation, { op: "ignore" }> | { op: "ignore"; nodeId: string; reason: string };

export const editMap = async (notebookId: string, baseVersion: number, operations: ClientOperation[]) =>
  ensure(await call<MapResponse>(`/api/notebooks/${encodeURIComponent(notebookId)}/map/edit`, { method: "POST", body: JSON.stringify({ baseVersion, operations }) }));

export const confirmMap = async (notebookId: string, version: number) =>
  ensure(await call<MapResponse>(`/api/notebooks/${encodeURIComponent(notebookId)}/map/confirm`, { method: "POST", body: JSON.stringify({ version }) }));
