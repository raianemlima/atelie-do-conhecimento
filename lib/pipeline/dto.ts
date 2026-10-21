import type { JobProgress, JobRow, StageRow } from "@/lib/pipeline/types";

// Visão pública do job: NUNCA inclui `output` das etapas (pode conter texto dos documentos).
export type PublicStage = Pick<StageRow, "id" | "stage" | "subjectId" | "position" | "status" | "attempts" | "maxAttempts" | "nextAttemptAt" | "error" | "cacheHit" | "durationMs" | "tokensIn" | "tokensOut" | "costUsd">;
export type JobView = { job: JobRow; stages: PublicStage[]; progress: JobProgress };
export type AdvanceResponse = { outcome: import("@/lib/pipeline/types").StepOutcome; view: JobView | null };

export const STAGE_LABELS: Record<string, string> = {
  extraction: "Extração", cleaning: "Limpeza", segmentation: "Segmentação", thematic_map: "Mapa temático", citation_registry: "Registro de citações",
  fusion: "Fusão por tema", drafting: "Redação didática", verification: "Verificação", export: "Exportação",
};
