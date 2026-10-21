// Alterna entre o fluxo atual (padrão) e o novo pipeline em estágios (ADR 002).
// O acesso literal a process.env.NEXT_PUBLIC_* é necessário para o Next embutir o valor no navegador.
export function isPipelineV2Enabled(value: string | undefined = process.env.NEXT_PUBLIC_PIPELINE_V2): boolean {
  return value === "true";
}
