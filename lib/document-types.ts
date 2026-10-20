export type DocumentFormat = "pdf" | "md" | "txt";

export type ExtractionStatus = "text" | "no-text" | "failed";

export type DocumentRecord = {
  id: string;
  title: string;
  fileName: string;
  format: DocumentFormat;
  size: number;
  importedAt: string;
  projectId: string | null;
  sha256: string;
  extractionStatus: ExtractionStatus;
  extractedText: string;
  pageTexts: string[];
  pageCount: number;
  original: Blob;
};

export type DocumentMetadata = Omit<DocumentRecord, "original">;

export const formatLabels: Record<DocumentFormat, string> = {
  pdf: "PDF",
  md: "Markdown",
  txt: "TXT",
};
