import { sha256 } from "@/lib/pipeline/hash";
import { STAGE_ORDER, type PipelineDocument, type PlannedStage, type StageHandler } from "@/lib/pipeline/types";

export const PIPELINE_VERSION = "2";

// Um job é identificado pelo conteúdo: mesmas fontes (por hash) + mesmas versões de estágio = mesmo job.
export function jobInputHash(documents: Pick<PipelineDocument, "sha256">[], handlers: StageHandler[]): string {
  const sources = documents.map((document) => document.sha256).sort();
  const stages = handlers.map((handler) => `${handler.stage}@${handler.version}`).sort();
  return sha256(JSON.stringify({ pipeline: PIPELINE_VERSION, sources, stages }));
}

export function planStages(documents: Pick<PipelineDocument, "id">[], handlers: StageHandler[]): PlannedStage[] {
  const ordered = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  const planned: PlannedStage[] = [];
  for (const stage of STAGE_ORDER) {
    const handler = handlers.find((candidate) => candidate.stage === stage);
    if (!handler) continue;
    if (handler.scope === "document") ordered.forEach((document) => planned.push({ stage, subjectId: document.id, position: planned.length + 1 }));
    else planned.push({ stage, subjectId: null, position: planned.length + 1 });
  }
  return planned;
}
