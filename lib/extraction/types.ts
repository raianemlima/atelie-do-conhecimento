export type RawItem = { text: string; x: number; y: number; width: number; fontSize: number };

export type BlockKind = "body" | "header" | "footer" | "footnote" | "table";
export type LayoutBlock = {
  kind: BlockKind;
  text: string;
  fontSize: number;
  y: number;
  column: 0 | 1 | null;
  heading: boolean;
  source: "text-layer" | "ocr";
};

export type ExtractedPage = {
  page: number;
  width: number;
  height: number;
  blocks: LayoutBlock[];
  charCount: number;
  hasTextLayer: boolean;
  hasImages: boolean;
  blank: boolean;
  needsOcr: boolean;
  ocr: "not-needed" | "unavailable" | "done";
};

export type ExtractionWarning = { code: "ocr_unavailable" | "ocr_failed"; pages: number[]; message: string };

export type DocumentExtraction = {
  format: "pdf" | "docx" | "md" | "txt";
  status: "text" | "partial" | "no-text";
  pageCount: number;
  pages: ExtractedPage[];
  warnings: ExtractionWarning[];
};

export type ExtractionErrorCode = "corrupted" | "password_protected" | "unsupported" | "too_large";

// Falha de extração: nunca retentável (reprocessar o mesmo arquivo dá o mesmo resultado) e sempre com ação sugerida.
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
  }
}

// Porta de OCR: a implementação (tesseract, serviço em nuvem…) é decisão do produto e ainda não existe.
// Recebe o PDF original e as páginas SEM camada de texto; devolve o texto reconhecido por página.
export type OcrProvider = {
  id: string;
  recognize(input: { bytes: Uint8Array; pages: number[] }): Promise<Record<number, string>>;
};

export type ExtractOptions = { ocr?: OcrProvider };

export const MIN_TEXT_CHARS = 20;
export const MAX_PDF_PAGES = 5000;
