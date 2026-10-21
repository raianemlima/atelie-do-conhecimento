import { DRAFT_SYSTEM_PROMPT, buildDraftPrompt } from "@/lib/drafting/prompt";
import type { DraftInput } from "@/lib/drafting/types";

// Preço em dólares por milhão de tokens. Vem da configuração: nenhum preço é fixado no código.
export type Pricing = { inputUsdPerMTok: number; outputUsdPerMTok: number };
export type CostEstimate = { themes: number; tokensIn: number; tokensOut: number; costUsd: number; approximate: true };

const CHARS_PER_TOKEN = 3.5;
export const ESTIMATED_OUTPUT_TOKENS_PER_THEME = 1500;

// Estimativa pré-voo (antes de qualquer chamada): entrada medida no prompt real, saída pelo limite por chamada.
export function estimateDraftCost(inputs: DraftInput[], pricing: Pricing, maxTokensPerCall: number): CostEstimate {
  const tokensIn = inputs.reduce((total, input) => total + Math.ceil((DRAFT_SYSTEM_PROMPT.length + buildDraftPrompt(input).length) / CHARS_PER_TOKEN), 0);
  const tokensOut = inputs.length * Math.min(maxTokensPerCall, ESTIMATED_OUTPUT_TOKENS_PER_THEME);
  const costUsd = (tokensIn * pricing.inputUsdPerMTok + tokensOut * pricing.outputUsdPerMTok) / 1_000_000;
  return { themes: inputs.length, tokensIn, tokensOut, costUsd: Math.round(costUsd * 1_000_000) / 1_000_000, approximate: true };
}
