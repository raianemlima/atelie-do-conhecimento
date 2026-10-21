import type { AdvanceResponse, JobView } from "@/lib/pipeline/dto";

type ApiFailure = { error?: { message?: string } };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = (await response.json().catch(() => ({}))) as T & ApiFailure;
  if (!response.ok) throw new Error(payload.error?.message ?? `Falha na requisição (${response.status}).`);
  return payload;
}

export const startJob = (input: { name: string; documentIds: string[] }) => call<{ created: boolean; view: JobView }>("/api/jobs", { method: "POST", body: JSON.stringify(input) });
export const listActiveJobs = () => call<{ jobs: JobView[] }>("/api/jobs?active=1");
export const advanceJobStep = (jobId: string) => call<AdvanceResponse>(`/api/jobs/${encodeURIComponent(jobId)}/advance`, { method: "POST" });
