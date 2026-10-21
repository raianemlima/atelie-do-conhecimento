export type CitationKind = "law" | "sumula" | "case" | "theme" | "informativo" | "thesis" | "author";

// Citação reconhecida em UM parágrafo, antes de agrupar no registro.
export type ExtractedCitation = {
  kind: CitationKind;
  // Chave canônica: duas formas de escrever a mesma referência têm a mesma chave.
  key: string;
  label: string;
  fields: Record<string, string | number | boolean | null>;
  // Trecho exato do texto de origem (verbatim) e sua posição no parágrafo.
  raw: string;
  start: number;
  end: number;
  // Texto citado (conteúdo de súmula, de artigo ou tese), exatamente como na fonte.
  statement?: string;
  // Metadados da ocorrência (relator, data, obra, página…).
  detail?: Record<string, string>;
};

export type Occurrence = { documentId: string; segmentId: string; paragraph: number; pages: number[]; raw: string; start: number; end: number; detail?: Record<string, string> };

export type Divergence = { field: "statement" | "relator" | "judgedAt" | "publishedAt" | "body"; values: { documentId: string; value: string }[] };

export type Citation = {
  id: string;
  kind: CitationKind;
  key: string;
  label: string;
  fields: Record<string, string | number | boolean | null>;
  occurrences: Occurrence[];
  // Formas distintas em que apareceu escrita (verbatim), no máximo 20.
  variants: string[];
  documentIds: string[];
  statements: { documentId: string; text: string }[];
  divergences: Divergence[];
};

export type CitationRegistry = {
  schema: 1;
  documents: { id: string; title: string }[];
  citations: Citation[];
  warnings: string[];
  stats: { total: number; byKind: Record<CitationKind, number>; divergent: number; ambiguousDiploma: number; multiSource: number };
};

export const KIND_LABELS: Record<CitationKind, string> = { law: "Legislação", sumula: "Súmulas", case: "Julgados", theme: "Temas", informativo: "Informativos", thesis: "Teses", author: "Autores" };
export const KIND_ORDER: CitationKind[] = ["law", "sumula", "case", "theme", "informativo", "thesis", "author"];
