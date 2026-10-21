export type CoverageItem = { segmentId: string; documentId: string; title: string | null; pages: number[]; chars: number };

export type MapNode = {
  id: string;
  level: 1 | 2;
  parentId: string | null;
  title: string;
  aliases: string[];
  // Menor similaridade usada para agrupar títulos (1 = títulos equivalentes; sem agrupamento = 1).
  confidence: number;
  needsReview: boolean;
  singleSource: boolean;
  // Itens nunca são apagados: ignorar é um registro explícito, com motivo.
  ignored: { reason: string; at: string } | null;
  coverage: CoverageItem[];
  documentIds: string[];
  chars: number;
  order: number;
  origin: "auto" | "edited";
};

export type ThematicMap = {
  schema: 1;
  discipline: string;
  documents: { id: string; title: string }[];
  nodes: MapNode[];
  warnings: string[];
  stats: { themes: number; subthemes: number; segments: number; chars: number; singleSourceThemes: number; needsReview: number };
};

export const SIMILARITY_THRESHOLD = 0.7;
export const REVIEW_CONFIDENCE = 0.85;
export const INTRO_TITLE = "Conteúdo introdutório (sem título)";
