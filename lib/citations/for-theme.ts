import type { Citation, CitationRegistry } from "@/lib/citations/types";
import type { MapNode } from "@/lib/thematic/types";

// Citações que aparecem na cobertura de um nó do mapa temático (por trecho de origem).
export function citationsForNode(registry: CitationRegistry, node: Pick<MapNode, "coverage">): Citation[] {
  const segments = new Set(node.coverage.map((item) => item.segmentId));
  return registry.citations.filter((citation) => citation.occurrences.some((occurrence) => segments.has(occurrence.segmentId)));
}
