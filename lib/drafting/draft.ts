import type { AiProvider } from "@/lib/ai/types";
import { extractCitations } from "@/lib/citations/extract";
import { buildDraftPrompt, DRAFT_SYSTEM_PROMPT } from "@/lib/drafting/prompt";
import { DraftValidationError, parseDraft } from "@/lib/drafting/schema";
import type { DraftInput, ThemeDraft, ThemeDraftResult } from "@/lib/drafting/types";

export const MAX_DRAFT_ATTEMPTS = 2;

const textOf = (draft: ThemeDraft) => [draft.title, ...draft.blocks.flatMap((b) => [b.heading, ...b.paragraphs, ...(b.table ? [...b.table.headers, ...b.table.rows.flat()] : [])])].join("\n");
const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Regras de aceitação independentes do modelo: citações só do conjunto fornecido e nenhuma menção à origem.
export function checkDraft(draft: ThemeDraft, input: DraftInput): string[] {
  const allowed = new Set(input.citations.map((c) => c.key));
  const problems: string[] = [];
  for (const key of draft.citationsUsed) if (!allowed.has(key)) problems.push(`citação fora da lista: ${key}`);
  for (const found of extractCitations(textOf(draft))) if (!allowed.has(found.key)) problems.push(`citação no texto fora da lista: ${found.label}`);
  const body = plain(textOf(draft));
  for (const term of input.forbiddenTerms) if (term.trim().length >= 3 && body.includes(plain(term))) problems.push("menção à origem do material");
  return [...new Set(problems)];
}

// Gera um tema (nunca a apostila inteira). Resposta cortada, fora do schema ou fora das regras é recusada e tentada de novo.
export async function draftTheme(provider: AiProvider, input: DraftInput, options: { maxTokens: number }): Promise<ThemeDraftResult> {
  const result: ThemeDraftResult = { themeId: input.themeId, title: input.title, draft: null, removedCitations: [], error: null, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt += 1) {
    const response = await provider.generate({ system: DRAFT_SYSTEM_PROMPT, prompt: buildDraftPrompt(input) + feedback, maxTokens: options.maxTokens });
    result.tokensIn += response.tokensIn;
    result.tokensOut += response.tokensOut;
    result.costUsd += response.costUsd;
    if (response.stopReason === "max_tokens") { result.error = "A resposta da IA foi cortada pelo limite de tamanho."; feedback = "\n\nA resposta anterior foi cortada: seja mais conciso."; continue; }
    try {
      const draft = parseDraft(response.text);
      const problems = checkDraft(draft, input);
      if (problems.length === 0) return { ...result, draft, error: null };
      result.removedCitations = problems;
      result.error = `Resposta recusada: ${problems.join("; ")}.`;
      feedback = `\n\nA resposta anterior foi recusada: ${problems.join("; ")}. Corrija.`;
    } catch (error) {
      if (!(error instanceof DraftValidationError)) throw error;
      result.error = error.message;
      feedback = `\n\nA resposta anterior foi recusada: ${error.message} Responda só com o JSON pedido.`;
    }
  }
  return result;
}
