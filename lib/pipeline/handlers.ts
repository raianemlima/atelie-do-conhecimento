import { cleanDocument, CLEANER_VERSION } from "@/lib/cleaning/clean";
import { cleanDocumentText } from "@/lib/text-cleaner";
import { extractOriginal, ExtractionError, type DocumentExtraction } from "@/lib/extraction";
import { sha256 } from "@/lib/pipeline/hash";
import { StageError, type Json, type StageContext, type StageHandler } from "@/lib/pipeline/types";

function previousOutput(stages: StageContext["stages"], stage: string, subjectId: string | null) {
  const output = stages.find((row) => row.stage === stage && row.subjectId === subjectId)?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new StageError(`Saída da etapa anterior (${stage}) ausente.`, false);
  return output as { [key: string]: Json };
}

// ---------------------------------------------------------------------------------------------------------------
// Fase 3: extração no servidor a partir do ARQUIVO ORIGINAL (nunca do texto vindo do navegador) e limpeza
// determinística. O OCR só roda nas páginas sem camada de texto e só se um provedor estiver configurado.
// ---------------------------------------------------------------------------------------------------------------
export const extractionHandlerV2: StageHandler = {
  stage: "extraction",
  scope: "document",
  version: "2",
  async inputKey({ stage, deps }) {
    const document = stage.subjectId ? await deps.loadDocument(stage.subjectId) : null;
    if (!document) throw new StageError("Documento da fonte não encontrado.", false);
    return `${document.sha256}:${deps.ocr?.id ?? "sem-ocr"}`;
  },
  async run({ stage, deps }) {
    const document = stage.subjectId ? await deps.loadDocument(stage.subjectId) : null;
    if (!document) throw new StageError("Documento da fonte não encontrado.", false);
    const bytes = deps.loadOriginal ? await deps.loadOriginal(document.id) : null;
    if (!bytes) throw new StageError("O arquivo original não foi encontrado no armazenamento. Reenvie o documento.", false);
    try {
      const extraction = await extractOriginal(document.format, bytes, { ocr: deps.ocr });
      return { output: extraction as unknown as Json };
    } catch (error) {
      if (error instanceof ExtractionError) throw new StageError(error.message, false);
      throw error;
    }
  },
};

export const cleaningHandlerV2: StageHandler = {
  stage: "cleaning",
  scope: "document",
  version: CLEANER_VERSION,
  inputKey({ stage, stages, deps }) {
    const extraction = previousOutput(stages, "extraction", stage.subjectId);
    return sha256(JSON.stringify({ extraction, knownTerms: [...(deps.knownTerms ?? [])].sort() }));
  },
  run({ stage, stages, deps }) {
    const extraction = previousOutput(stages, "extraction", stage.subjectId) as unknown as DocumentExtraction;
    return Promise.resolve({ output: cleanDocument(extraction, { knownTerms: deps.knownTerms }) as unknown as Json });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Fluxo da Fase 2 (texto extraído no navegador + limpador antigo). Mantido para os testes de caracterização.
// ---------------------------------------------------------------------------------------------------------------
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

function pagesOf(output: { [key: string]: Json }): string[] {
  const pages = output.pageTexts;
  return Array.isArray(pages) && pages.every((page) => typeof page === "string") ? (pages as string[]) : [];
}

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

export const LEGACY_HANDLERS: StageHandler[] = [extractionHandler, cleaningHandler];
export const DEFAULT_HANDLERS: StageHandler[] = [extractionHandlerV2, cleaningHandlerV2];
