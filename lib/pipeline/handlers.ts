import { cleanDocument, CLEANER_VERSION } from "@/lib/cleaning/clean";
import { cleanDocumentText } from "@/lib/text-cleaner";
import { extractOriginal, ExtractionError, type DocumentExtraction } from "@/lib/extraction";
import { segmentDocument } from "@/lib/segmentation/segment";
import type { SegmentationResult } from "@/lib/segmentation/types";
import { buildThematicMap } from "@/lib/thematic/build";
import { sha256 } from "@/lib/pipeline/hash";
import { settingsKey } from "@/lib/pipeline/options";
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
    return sha256(JSON.stringify({ extraction, settings: settingsKey({ knownTerms: deps.knownTerms ?? [], keepReferences: deps.keepReferences ?? [], keepProfessors: deps.keepProfessors === true }) }));
  },
  run({ stage, stages, deps }) {
    const extraction = previousOutput(stages, "extraction", stage.subjectId) as unknown as DocumentExtraction;
    return Promise.resolve({ output: cleanDocument(extraction, { knownTerms: deps.knownTerms, keepReferences: deps.keepReferences, professors: deps.keepProfessors ? "keep" : "remove" }) as unknown as Json });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Fase 4: segmentação estrutural por documento e mapa temático do caderno.
// ---------------------------------------------------------------------------------------------------------------
export const SEGMENTATION_VERSION = "1";

export const segmentationHandler: StageHandler = {
  stage: "segmentation",
  scope: "document",
  version: SEGMENTATION_VERSION,
  inputKey({ stage, stages }) {
    return sha256(JSON.stringify(previousOutput(stages, "cleaning", stage.subjectId).paragraphs));
  },
  async run({ stage, stages, deps }) {
    const document = stage.subjectId ? await deps.loadDocument(stage.subjectId) : null;
    if (!document) throw new StageError("Documento da fonte não encontrado.", false);
    const paragraphs = previousOutput(stages, "cleaning", stage.subjectId).paragraphs as unknown as Parameters<typeof segmentDocument>[2];
    return { output: segmentDocument(document.id, document.sha256, paragraphs) as unknown as Json };
  },
};

function segmentationsOf(stages: StageContext["stages"]) {
  return stages.filter((row) => row.stage === "segmentation" && row.subjectId !== null).sort((a, b) => (a.subjectId as string).localeCompare(b.subjectId as string));
}

// Sem cache: é barato, determinístico e tem efeito colateral (salvar a versão do mapa) que precisa rodar em todo job.
export const thematicMapHandler: StageHandler = {
  stage: "thematic_map",
  scope: "notebook",
  version: "1",
  cache: false,
  inputKey({ stages, deps }) {
    const fingerprint = segmentationsOf(stages).map((row) => ((row.output as unknown as SegmentationResult).segments ?? []).map((segment) => [segment.id, segment.level, segment.kind, segment.title, segment.chars]));
    return sha256(JSON.stringify({ fingerprint, discipline: deps.discipline ?? "" }));
  },
  async run({ job, stages, deps }) {
    const rows = segmentationsOf(stages);
    const documents = await Promise.all(rows.map(async (row) => {
      const document = await deps.loadDocument(row.subjectId as string);
      return { id: row.subjectId as string, title: document?.title ?? (row.subjectId as string) };
    }));
    const segmentations = rows.map((row) => row.output as unknown as SegmentationResult);
    const map = buildThematicMap({ discipline: deps.discipline?.trim() || "Geral", documents, segmentations });
    const saved = await deps.mapStore?.saveAuto({ notebookId: job.notebookId, jobId: job.id, map });
    return { output: { version: saved?.version ?? null, map } as unknown as Json };
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
export const DEFAULT_HANDLERS: StageHandler[] = [extractionHandlerV2, cleaningHandlerV2, segmentationHandler, thematicMapHandler];
