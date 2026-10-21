import type { CitationRegistry } from "@/lib/citations/types";
import type { ThemeDraftResult } from "@/lib/drafting/types";
import type { StageRow } from "@/lib/pipeline/types";
import type { ThematicMap } from "@/lib/thematic/types";

export type ExportPartData = { map: ThematicMap; drafts: ThemeDraftResult[]; registry: CitationRegistry };

// Só exporta o que passou na verificação: usa as redações JÁ corrigidas pelo verificador (citações não confirmadas removidas).
export function partFromStages(stages: StageRow[]): ExportPartData | null {
  const output = (stage: string) => stages.find((row) => row.stage === stage && row.status === "succeeded")?.output as Record<string, unknown> | null | undefined;
  const verification = output("verification");
  const mapOutput = output("thematic_map");
  const registry = output("citation_registry");
  if (!verification || verification.skipped === true || !Array.isArray(verification.drafts) || !mapOutput?.map || !registry) return null;
  return { map: mapOutput.map as ThematicMap, drafts: verification.drafts as ThemeDraftResult[], registry: registry as unknown as CitationRegistry };
}
