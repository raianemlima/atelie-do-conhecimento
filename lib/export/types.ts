import type { CitationKind } from "@/lib/citations/types";

export type RenderBlock =
  | { kind: "subheading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

// level 1 = capítulo; level 2 = seção do capítulo.
export type ExportSection = { id: string; number: string; title: string; level: 1 | 2; blocks: RenderBlock[] };
export type ExportPart = { id: string; title: string; sections: ExportSection[] };
export type IndexEntry = { key: string; label: string; refs: string[] };
export type IndexGroup = { kind: CitationKind; title: string; entries: IndexEntry[] };
export type GlossaryEntry = { term: string; definition: string; ref: string };

// Representação intermediária única: PDF, DOCX e Markdown são escritos a partir dela.
export type ExportDocument = {
  title: string;
  subtitle: string;
  parts: ExportPart[];
  index: IndexGroup[];
  glossary: GlossaryEntry[];
  warnings: string[];
  stats: { chapters: number; sections: number; indexEntries: number; glossaryTerms: number };
};

export type ExportFormat = "pdf" | "docx" | "md";
export type ExportedFile = { format: ExportFormat; fileName: string; contentType: string; bytes: Uint8Array };

export const FORMAT_CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
};
