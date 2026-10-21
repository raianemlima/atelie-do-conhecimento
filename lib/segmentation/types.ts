export type SegmentParagraph = { text: string; pages: number[]; kind: "body" | "table" | "footnote" };

// Janela de leitura de um trecho longo: cobre os parágrafos [from, core[1]); os "core" particionam o trecho
// e [from, core[0]) é a sobreposição controlada com a janela anterior.
export type SegmentWindow = { from: number; core: [number, number] };

export type Segment = {
  id: string;
  documentId: string;
  order: number;
  level: number;
  kind: "section" | "article" | "preamble";
  numbering: string | null;
  title: string | null;
  // Títulos dos ancestrais, do mais alto ao mais próximo (não inclui o próprio).
  path: string[];
  paragraphs: SegmentParagraph[];
  pages: number[];
  chars: number;
  // Título sem conteúdo próprio (ex.: "CAPÍTULO I" seguido direto de uma seção).
  container: boolean;
  windows: SegmentWindow[];
};

export type IgnoredItem = { reason: "toc_entry" | "toc_title"; text: string; pages: number[] };

export type SegmentationResult = {
  documentId: string;
  segments: Segment[];
  ignored: IgnoredItem[];
  warnings: string[];
  stats: { paragraphs: number; segments: number; headings: number; chars: number };
};

export type SegmentationOptions = { maxChars?: number; overlapChars?: number };
export const DEFAULT_MAX_SEGMENT_CHARS = 6000;
export const DEFAULT_OVERLAP_CHARS = 400;
export const ARTICLE_LEVEL = 9;
