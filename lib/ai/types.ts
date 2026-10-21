export type AiRequest = { system: string; prompt: string; maxTokens: number };

export type AiResponse = {
  text: string;
  // "max_tokens" = resposta cortada pelo limite; nunca é aceita como texto final.
  stopReason: "end" | "max_tokens" | "other";
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

// Contrato do provedor de IA. Nenhuma implementação real existe ainda: chamadas reais exigem autorização e teto de custo.
export interface AiProvider {
  id: string;
  generate(request: AiRequest): Promise<AiResponse>;
}

export type AiBudget = { maxCostUsd: number; maxTokensPerCall: number };
