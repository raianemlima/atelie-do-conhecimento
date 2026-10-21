export const STAGE_ORDER = ["extraction", "cleaning", "segmentation", "thematic_map", "citation_registry", "fusion", "drafting", "verification", "export"] as const;
export type StageName = (typeof STAGE_ORDER)[number];
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JobRow = {
  id: string;
  notebookId: string;
  kind: string;
  status: JobStatus;
  inputHash: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type StageRow = {
  id: string;
  jobId: string;
  stage: StageName;
  subjectId: string | null;
  position: number;
  status: StageStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseExpiresAt: string | null;
  inputHash: string | null;
  output: Json | null;
  cacheHit: boolean;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type PlannedStage = { stage: StageName; subjectId: string | null; position: number };

export type PipelineDocument = {
  id: string;
  title?: string;
  format: "pdf" | "docx" | "md" | "txt";
  sha256: string;
  extractionStatus: "text" | "no-text" | "failed";
  pageTexts: string[];
  pageCount: number;
};

export type PipelineDeps = {
  loadDocument(id: string): Promise<PipelineDocument | null>;
  // Bytes do arquivo original (o texto extraído no navegador não é confiável). Ausente = não disponível.
  loadOriginal?(id: string): Promise<Uint8Array | null>;
  ocr?: import("@/lib/extraction/types").OcrProvider;
  // Opções de limpeza do caderno (lista da usuária).
  knownTerms?: string[];
  keepReferences?: string[];
  keepProfessors?: boolean;
  // Disciplina do caderno (raiz do mapa temático) e onde guardar as versões do mapa.
  discipline?: string;
  mapStore?: import("@/lib/thematic/store").ThematicMapStore;
};

export type StageResult = { output: Json; tokensIn?: number; tokensOut?: number; costUsd?: number };

export type StageContext = { job: JobRow; stage: StageRow; stages: StageRow[]; deps: PipelineDeps };

export type StageHandler = {
  stage: StageName;
  scope: "document" | "notebook";
  // Mude a versão sempre que a lógica ou o prompt do estágio mudar: invalida o cache por hash.
  version: string;
  // false = nunca usar o cache por hash (etapa barata e determinística, ou com efeito colateral que precisa rodar sempre).
  cache?: boolean;
  inputKey(context: StageContext): Promise<string> | string;
  run(context: StageContext): Promise<StageResult>;
};

export class StageError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "StageError";
    this.retryable = retryable;
  }
}

export type JobProgress = { done: number; total: number; percent: number; currentStage: StageName | null };

export type StepOutcome =
  | { kind: "progressed"; stage: StageName; subjectId: string | null; cacheHit: boolean }
  | { kind: "waiting"; retryAt: string }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "failed"; error: string };

export interface PipelineRepository {
  createJob(input: { notebookId: string; inputHash: string; stages: PlannedStage[]; maxAttempts: number }): Promise<{ job: JobRow; created: boolean }>;
  getJob(jobId: string): Promise<JobRow | null>;
  listStages(jobId: string): Promise<StageRow[]>;
  claimNextStage(jobId: string, now: Date, leaseMs: number): Promise<StageRow | null>;
  completeStage(stageId: string, result: { output: Json; inputHash: string; cacheHit: boolean; durationMs: number; tokensIn: number; tokensOut: number; costUsd: number }): Promise<void>;
  failStage(stageId: string, error: string, durationMs: number): Promise<void>;
  scheduleRetry(stageId: string, nextAttemptAt: Date, error: string, durationMs: number): Promise<void>;
  setJobStatus(jobId: string, status: JobStatus, error?: string | null): Promise<void>;
  getCached(stage: StageName, inputHash: string): Promise<Json | null>;
  putCached(stage: StageName, inputHash: string, output: Json): Promise<void>;
}

export function summarizeProgress(stages: StageRow[]): JobProgress {
  const total = stages.length;
  const done = stages.filter((stage) => stage.status === "succeeded" || stage.status === "skipped").length;
  const current = stages.find((stage) => stage.status !== "succeeded" && stage.status !== "skipped") ?? null;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), currentStage: current?.stage ?? null };
}
