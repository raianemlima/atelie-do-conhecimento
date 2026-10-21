import { cleanDocumentText } from "@/lib/text-cleaner";
import { sha256 } from "@/lib/pipeline/hash";
import { StageError, type Json, type StageHandler } from "@/lib/pipeline/types";

// Fase 2: apenas os estágios que já têm implementação. As demais fases registram os seus aqui.
// Extração: reaproveita o texto já extraído do documento (a extração no servidor e o OCR chegam na Fase 3).
export const extractionHandler: StageHandler = {
  stage: "extraction",
  scope: "document",
  version: "1",
  async inputKey({ stage, deps }) {
    const document = stage.subjectId ? await deps.loadDocument(stage.subjectId) : null;
    if (!document) throw new StageError("Documento da fonte não encontrado.", false);
    return document.sha256;
  },
  async run({ stage, deps }) {
    const document = stage.subjectId ? await deps.loadDocument(stage.subjectId) : null;
    if (!document) throw new StageError("Documento da fonte não encontrado.", false);
    if (document.extractionStatus === "failed") throw new StageError("A extração deste documento falhou na importação. Reenvie o arquivo.", false);
    return { output: { status: document.extractionStatus, pageCount: document.pageCount, pageTexts: document.pageTexts } satisfies Json };
  },
};

function previousOutput(stages: { stage: string; subjectId: string | null; output: Json | null }[], stage: string, subjectId: string | null) {
  const output = stages.find((row) => row.stage === stage && row.subjectId === subjectId)?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new StageError(`Saída da etapa anterior (${stage}) ausente.`, false);
  return output as { [key: string]: Json };
}

function pagesOf(output: { [key: string]: Json }): string[] {
  const pages = output.pageTexts;
  return Array.isArray(pages) && pages.every((page) => typeof page === "string") ? (pages as string[]) : [];
}

// Limpeza: por enquanto aplica o limpador atual. A limpeza determinística completa é a Fase 3.
export const cleaningHandler: StageHandler = {
  stage: "cleaning",
  scope: "document",
  version: "1",
  inputKey({ stage, stages }) {
    return sha256(JSON.stringify(pagesOf(previousOutput(stages, "extraction", stage.subjectId))));
  },
  run({ stage, stages }) {
    const pages = pagesOf(previousOutput(stages, "extraction", stage.subjectId));
    const text = cleanDocumentText(pages.join("\n\n"), pages);
    return Promise.resolve({ output: { text, characters: text.length } });
  },
};

export const DEFAULT_HANDLERS: StageHandler[] = [extractionHandler, cleaningHandler];
