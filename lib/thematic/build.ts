import { sha256 } from "@/lib/pipeline/hash";
import type { Segment, SegmentationResult } from "@/lib/segmentation/types";
import { INTRO_TITLE, REVIEW_CONFIDENCE, SIMILARITY_THRESHOLD, type CoverageItem, type MapNode, type ThematicMap } from "@/lib/thematic/types";
import { isGenericTitle, normalizeTitle, titleSimilarity } from "@/lib/thematic/titles";

export type MapInput = {
  discipline: string;
  documents: { id: string; title: string }[];
  segmentations: SegmentationResult[];
};

type Draft = { title: string; documentId: string; coverage: CoverageItem[]; children: Draft[] };
type Cluster = { members: Draft[]; confidence: number };

const coverageOf = (segment: Segment): CoverageItem => ({ segmentId: segment.id, documentId: segment.documentId, title: segment.title, pages: segment.pages, chars: segment.chars });
const hasContent = (segment: Segment) => segment.chars > 0;

// Cada documento vira uma árvore de rascunhos (tema > subtema) + um balde de conteúdo sem título.
function draftsOf(segmentation: SegmentationResult, documentTitle: string): { themes: Draft[]; intro: CoverageItem[]; unstructured: boolean } {
  const sections = segmentation.segments.filter((segment) => segment.kind === "section" && segment.title !== null);
  if (!sections.length) {
    const coverage = segmentation.segments.filter(hasContent).map(coverageOf);
    return { themes: coverage.length ? [{ title: documentTitle, documentId: segmentation.documentId, coverage, children: [] }] : [], intro: [], unstructured: true };
  }
  const byLevel = new Map<number, number>();
  sections.forEach((segment) => byLevel.set(segment.level, (byLevel.get(segment.level) ?? 0) + 1));
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const totalChars = segmentation.segments.reduce((total, segment) => total + segment.chars, 0);
  // Um único título no topo é só o nome do documento (envoltório) quando quase não tem conteúdo próprio
  // e há um nível mais fundo com 2 ou mais seções; do contrário, é um tema de verdade.
  const isWrapper = (level: number) => {
    const only = sections.find((segment) => segment.level === level) as Segment;
    return (byLevel.get(level) ?? 0) === 1 && only.chars < totalChars * 0.1 && levels.some((deeper) => deeper > level && (byLevel.get(deeper) ?? 0) >= 2);
  };
  const topLevel = levels.find((level) => (byLevel.get(level) ?? 0) >= 2 || !isWrapper(level)) ?? levels[0];

  const themes: Draft[] = [];
  const intro: CoverageItem[] = [];
  let theme: Draft | null = null;
  let sub: Draft | null = null;
  const place = (segment: Segment) => {
    if (!hasContent(segment)) return;
    const target = sub ?? theme;
    (target ? target.coverage : intro).push(coverageOf(segment));
  };
  for (const segment of segmentation.segments) {
    if (segment.kind === "section" && segment.title !== null && segment.level === topLevel) {
      theme = { title: segment.title, documentId: segmentation.documentId, coverage: [], children: [] };
      themes.push(theme);
      sub = null;
      place(segment);
    } else if (segment.kind === "section" && segment.title !== null && segment.level === topLevel + 1 && theme) {
      sub = { title: segment.title, documentId: segmentation.documentId, coverage: [], children: [] };
      theme.children.push(sub);
      place(segment);
    } else if (segment.kind === "section" && segment.title !== null && segment.level < topLevel) {
      theme = null;
      sub = null;
      place(segment);
    } else {
      place(segment);
    }
  }
  return { themes, intro, unstructured: false };
}

function clusterDrafts(drafts: Draft[], threshold: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const draft of drafts) {
    let best: { cluster: Cluster; score: number } | null = null;
    for (const cluster of clusters) {
      const score = Math.max(...cluster.members.map((member) => titleSimilarity(member.title, draft.title)));
      const sameDocument = cluster.members.some((member) => member.documentId === draft.documentId);
      if (score >= threshold && (!sameDocument || score === 1) && (!best || score > best.score)) best = { cluster, score };
    }
    if (best) { best.cluster.members.push(draft); best.cluster.confidence = Math.min(best.cluster.confidence, best.score); }
    else clusters.push({ members: [draft], confidence: 1 });
  }
  return clusters;
}

const isAllCaps = (value: string) => value === value.toUpperCase() && /\p{L}/u.test(value);

function canonicalTitle(titles: string[]): { title: string; aliases: string[] } {
  const counts = new Map<string, number>();
  titles.forEach((title) => counts.set(title, (counts.get(title) ?? 0) + 1));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(isAllCaps(a[0])) - Number(isAllCaps(b[0])) || b[0].length - a[0].length);
  return { title: ranked[0][0], aliases: ranked.slice(1).map(([title]) => title) };
}

export function buildThematicMap(input: MapInput, options: { threshold?: number } = {}): ThematicMap {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const titleOf = (id: string) => input.documents.find((document) => document.id === id)?.title ?? id;
  const warnings: string[] = [];
  const themeDrafts: Draft[] = [];
  const intro: CoverageItem[] = [];
  const unstructuredDocs = new Set<string>();
  for (const segmentation of input.segmentations) {
    const drafts = draftsOf(segmentation, titleOf(segmentation.documentId));
    themeDrafts.push(...drafts.themes);
    intro.push(...drafts.intro);
    if (drafts.unstructured && drafts.themes.length) { unstructuredDocs.add(segmentation.documentId); warnings.push(`"${titleOf(segmentation.documentId)}" não tem títulos reconhecíveis: virou um único tema, que precisa de revisão.`); }
    if (!segmentation.segments.some(hasContent)) warnings.push(`"${titleOf(segmentation.documentId)}" não tem conteúdo para mapear.`);
  }

  const nodes: MapNode[] = [];
  const usedIds = new Set<string>();
  const idFor = (level: number, title: string, parentId: string | null) => {
    let id = sha256(`${level}|${normalizeTitle(title) || title}|${parentId ?? ""}`).slice(0, 12);
    for (let attempt = 1; usedIds.has(id); attempt += 1) id = sha256(`${id}|${attempt}`).slice(0, 12);
    usedIds.add(id);
    return id;
  };
  const makeNode = (level: 1 | 2, parentId: string | null, cluster: Cluster, extraReview = false): MapNode => {
    const { title, aliases } = canonicalTitle(cluster.members.map((member) => member.title));
    const coverage = cluster.members.flatMap((member) => member.coverage);
    const documentIds = [...new Set(cluster.members.map((member) => member.documentId))];
    return {
      id: idFor(level, title, parentId), level, parentId, title, aliases, confidence: Math.round(cluster.confidence * 1000) / 1000,
      needsReview: cluster.confidence < REVIEW_CONFIDENCE || isGenericTitle(title) || extraReview,
      singleSource: input.documents.length > 1 && documentIds.length === 1, ignored: null, coverage, documentIds,
      chars: coverage.reduce((total, item) => total + item.chars, 0), order: nodes.length, origin: "auto",
    };
  };

  for (const themeCluster of clusterDrafts(themeDrafts, threshold)) {
    const unstructured = themeCluster.members.length === 1 && unstructuredDocs.has(themeCluster.members[0].documentId);
    const theme = makeNode(1, null, themeCluster, unstructured);
    nodes.push(theme);
    for (const subCluster of clusterDrafts(themeCluster.members.flatMap((member) => member.children), threshold)) nodes.push(makeNode(2, theme.id, subCluster));
  }
  if (intro.length) {
    const documentIds = [...new Set(intro.map((item) => item.documentId))];
    nodes.push({ id: idFor(1, INTRO_TITLE, null), level: 1, parentId: null, title: INTRO_TITLE, aliases: [], confidence: 1, needsReview: true, singleSource: input.documents.length > 1 && documentIds.length === 1, ignored: null, coverage: intro, documentIds, chars: intro.reduce((total, item) => total + item.chars, 0), order: nodes.length, origin: "auto" });
  }
  nodes.forEach((node, index) => { node.order = index; });
  return { schema: 1, discipline: input.discipline, documents: input.documents, nodes, warnings, stats: statsOf(nodes) };
}

export function statsOf(nodes: MapNode[]): ThematicMap["stats"] {
  const themes = nodes.filter((node) => node.level === 1);
  const segments = new Set(nodes.flatMap((node) => node.coverage.map((item) => item.segmentId)));
  return { themes: themes.length, subthemes: nodes.length - themes.length, segments: segments.size, chars: nodes.reduce((total, node) => total + node.chars, 0), singleSourceThemes: themes.filter((node) => node.singleSource).length, needsReview: nodes.filter((node) => node.needsReview && !node.ignored).length };
}

// Segmentos com conteúdo que o mapa PRECISA cobrir (exatamente uma vez). Base da checagem de completude.
export function contentSegmentIds(segmentations: SegmentationResult[]): string[] {
  return segmentations.flatMap((segmentation) => segmentation.segments.filter(hasContent).map((segment) => segment.id));
}
