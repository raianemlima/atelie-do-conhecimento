import { citationsForNode } from "@/lib/citations/for-theme";
import type { CitationRegistry } from "@/lib/citations/types";
import type { DraftInput } from "@/lib/drafting/types";
import type { SegmentationResult } from "@/lib/segmentation/types";
import type { MapNode, ThematicMap } from "@/lib/thematic/types";

// Fusão: reúne, por tema, os trechos de TODAS as fontes e o subconjunto do registro de citações que se aplica a eles.
export function buildDraftInputs(map: ThematicMap, segmentations: SegmentationResult[], registry: CitationRegistry): DraftInput[] {
  const segments = new Map(segmentations.flatMap((s) => s.segments.map((segment) => [segment.id, segment] as const)));
  const byId = new Map(map.nodes.map((node) => [node.id, node] as const));
  const hasChildren = new Set(map.nodes.filter((n) => n.parentId && !n.ignored).map((n) => n.parentId));
  const forbiddenTerms = map.documents.map((d) => d.title);
  const leaves = map.nodes.filter((node: MapNode) => !node.ignored && !hasChildren.has(node.id) && node.coverage.length > 0).sort((a, b) => a.order - b.order);
  return leaves.map((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const sources = node.coverage.flatMap((item) => {
      const segment = segments.get(item.segmentId);
      const text = segment ? segment.paragraphs.map((p) => p.text).join("\n") : "";
      return text.trim() ? [{ segmentId: item.segmentId, text }] : [];
    });
    return {
      themeId: node.id,
      title: node.title,
      path: parent ? [map.discipline, parent.title] : [map.discipline],
      sources,
      citations: citationsForNode(registry, node).map((c) => ({ key: c.key, label: c.label, statements: [...new Set(c.statements.map((s) => s.text))] })),
      forbiddenTerms,
    };
  });
}
