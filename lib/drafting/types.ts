export const BLOCK_TYPES = ["intro", "development", "comparison", "doctrine", "stf_stj", "attention", "review"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type DraftBlock = { type: BlockType; heading: string; paragraphs: string[]; table?: { headers: string[]; rows: string[][] } };

// Representação intermediária de um tema redigido (base da verificação e da exportação).
export type GlossaryTerm = { term: string; definition: string };
export type ThemeDraft = { title: string; blocks: DraftBlock[]; citationsUsed: string[]; glossary?: GlossaryTerm[] };

export type DraftSource = { segmentId: string; text: string };
export type DraftCitation = { key: string; label: string; statements: string[] };
export type DraftInput = { themeId: string; title: string; path: string[]; sources: DraftSource[]; citations: DraftCitation[]; forbiddenTerms: string[] };

export type ThemeDraftResult = { themeId: string; title: string; draft: ThemeDraft | null; removedCitations: string[]; error: string | null; tokensIn: number; tokensOut: number; costUsd: number };
