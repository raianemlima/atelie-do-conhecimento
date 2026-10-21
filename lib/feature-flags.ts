// Alterna entre o fluxo atual (padrão) e o novo pipeline em estágios (ADR 002).
// Enquanto o novo fluxo não for aprovado, o valor padrão é sempre "desligado".
export function isPipelineV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_PIPELINE_V2 === "true";
}
