import { BLOCK_TYPES, type BlockType, type DraftBlock, type ThemeDraft } from "@/lib/drafting/types";

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

// Valida a resposta da IA contra o schema. Qualquer desvio é erro: nada é "consertado" em silêncio.
export function parseDraft(text: string): ThemeDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new DraftValidationError("A resposta da IA não é um JSON válido.");
  }
  if (!isRecord(raw)) throw new DraftValidationError("A resposta da IA não é um objeto.");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new DraftValidationError("Título ausente.");
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) throw new DraftValidationError("O tema veio sem blocos.");
  if (!isStrings(raw.citationsUsed)) throw new DraftValidationError("citationsUsed deve ser uma lista de textos.");
  const blocks = raw.blocks.map((block, index): DraftBlock => {
    if (!isRecord(block)) throw new DraftValidationError(`Bloco ${index + 1} inválido.`);
    if (typeof block.type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(block.type)) throw new DraftValidationError(`Bloco ${index + 1}: tipo desconhecido.`);
    if (typeof block.heading !== "string" || !block.heading.trim()) throw new DraftValidationError(`Bloco ${index + 1}: título ausente.`);
    if (!isStrings(block.paragraphs)) throw new DraftValidationError(`Bloco ${index + 1}: parágrafos inválidos.`);
    const paragraphs = block.paragraphs.filter((p) => p.trim());
    let table: DraftBlock["table"];
    if (block.table !== undefined) {
      const t = block.table;
      if (!isRecord(t) || !isStrings(t.headers) || !Array.isArray(t.rows) || !t.rows.every(isStrings)) throw new DraftValidationError(`Bloco ${index + 1}: tabela inválida.`);
      table = { headers: t.headers, rows: t.rows as string[][] };
    }
    if (paragraphs.length === 0 && !table) throw new DraftValidationError(`Bloco ${index + 1} está vazio.`);
    return { type: block.type as BlockType, heading: block.heading.trim(), paragraphs, ...(table ? { table } : {}) };
  });
  let glossary: ThemeDraft["glossary"];
  if (raw.glossary !== undefined) {
    if (!Array.isArray(raw.glossary)) throw new DraftValidationError("glossary deve ser uma lista.");
    glossary = raw.glossary.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.term !== "string" || typeof entry.definition !== "string" || !entry.term.trim() || !entry.definition.trim()) throw new DraftValidationError(`Glossário: item ${index + 1} inválido.`);
      return { term: entry.term.trim(), definition: entry.definition.trim() };
    });
  }
  return { title: raw.title.trim(), blocks, citationsUsed: raw.citationsUsed, ...(glossary?.length ? { glossary } : {}) };
}
