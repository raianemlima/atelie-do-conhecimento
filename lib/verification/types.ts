export type Severity = "bloqueante" | "aviso";
export type Finding = { dimension: "limpeza" | "fidelidade" | "cobertura" | "integridade"; severity: Severity; themeId: string | null; message: string };

export type ReviewReport = {
  schema: 1;
  score: number;
  minScore: number;
  passed: boolean;
  dimensions: { limpeza: number; fidelidade: number; cobertura: number; integridade: number };
  findings: Finding[];
  // Citações não confirmadas pelo registro: removidas do texto e listadas aqui.
  removedCitations: { themeId: string; label: string; sentence: string }[];
  divergences: { label: string; fields: string[] }[];
  singleSourceThemes: string[];
  unlinkedSegments: string[];
  illegible: string[];
};
