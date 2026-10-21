import { sha256 } from "@/lib/pipeline/hash";
import type { CleanParagraph } from "@/lib/cleaning/clean";
import { classifyHeading, isTocEntry, isTocTitle, type HeadingInfo } from "@/lib/segmentation/headings";
import { ARTICLE_LEVEL, DEFAULT_MAX_SEGMENT_CHARS, DEFAULT_OVERLAP_CHARS, type IgnoredItem, type Segment, type SegmentationOptions, type SegmentationResult, type SegmentParagraph, type SegmentWindow } from "@/lib/segmentation/types";

export type SegmentInput = Pick<CleanParagraph, "text" | "pages" | "kind" | "heading" | "fontSize">;

const SEPARATOR = 2;

// Janelas sobrepostas para trechos longos: nenhum parágrafo é perdido e a sobreposição fica limitada a overlapChars.
export function buildWindows(paragraphs: SegmentParagraph[], maxChars: number, overlapChars: number): SegmentWindow[] {
  if (!paragraphs.length) return [];
  const size = (index: number) => paragraphs[index].text.length + SEPARATOR;
  const windows: SegmentWindow[] = [];
  let start = 0;
  while (start < paragraphs.length) {
    let end = start;
    let total = 0;
    while (end < paragraphs.length && (end === start || total + size(end) <= maxChars)) { total += size(end); end += 1; }
    let from = start;
    let carried = 0;
    while (windows.length && from > 0 && carried + size(from - 1) <= overlapChars && from - 1 >= windows[windows.length - 1].core[0]) { from -= 1; carried += size(from); }
    windows.push({ from, core: [start, end] });
    start = end;
  }
  return windows;
}

function styledLevels(items: SegmentInput[], infos: (HeadingInfo | null)[]): Map<number, number> {
  const sizes = [...new Set(items.flatMap((item, index) => (infos[index]?.kind === "styled" && item.fontSize > 0 ? [Math.round(item.fontSize * 10) / 10] : [])))].sort((a, b) => b - a);
  return new Map(sizes.map((size, rank) => [size, Math.min(rank + 1, 4)]));
}

export function segmentDocument(documentId: string, documentSha: string, input: SegmentInput[], options: SegmentationOptions = {}): SegmentationResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_SEGMENT_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const ignored: IgnoredItem[] = [];
  const infos = input.map((item) => (item.kind === "body" ? classifyHeading(item.text, item.heading) : null));
  const levelBySize = styledLevels(input, infos);
  let lastStyledLevel = 1;
  const consumed = new Set<number>();

  const segments: Segment[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Segment | null = null;
  let headings = 0;

  const open = (partial: Pick<Segment, "level" | "kind" | "numbering" | "title">, path: string[]): Segment => {
    const segment: Segment = { id: "", documentId, order: segments.length, ...partial, path, paragraphs: [], pages: [], chars: 0, container: true, windows: [] };
    segments.push(segment);
    return segment;
  };

  for (let index = 0; index < input.length; index += 1) {
    if (consumed.has(index)) continue;
    const item = input[index];
    if (item.kind === "body" && isTocEntry(item.text)) { ignored.push({ reason: "toc_entry", text: item.text, pages: item.pages }); continue; }
    if (item.kind === "body" && item.heading && isTocTitle(item.text)) { ignored.push({ reason: "toc_title", text: item.text, pages: item.pages }); continue; }
    let info = infos[index];
    if (info?.kind === "styled") {
      const level = levelBySize.get(Math.round(item.fontSize * 10) / 10) ?? lastStyledLevel;
      info = { ...info, level };
      lastStyledLevel = level;
    }
    if (info?.needsContinuation) {
      const next = input[index + 1];
      // "TÍTULO II" sozinho numa linha: o nome ("DOS DIREITOS E GARANTIAS…") vem no parágrafo seguinte.
      if (next && next.kind === "body" && next.text.length <= 120 && !isTocEntry(next.text) && !classifyHeading(next.text, false) && (next.heading || next.text === next.text.toUpperCase())) { info = { ...info, title: next.text.trim() }; consumed.add(index + 1); }
    }
    if (info && info.kind !== "article") {
      headings += 1;
      while (stack.length && stack[stack.length - 1].level >= info.level) stack.pop();
      current = open({ level: info.level, kind: "section", numbering: info.numbering, title: info.title || info.numbering }, stack.map((entry) => entry.title));
      stack.push({ level: info.level, title: current.title ?? "" });
      continue;
    }
    if (info?.kind === "article") {
      headings += 1;
      current = open({ level: ARTICLE_LEVEL, kind: "article", numbering: info.numbering, title: info.title }, stack.map((entry) => entry.title));
    }
    if (!current) current = open({ level: 0, kind: "preamble", numbering: null, title: null }, []);
    current.paragraphs.push({ text: item.text, pages: item.pages, kind: item.kind });
  }

  for (const segment of segments) {
    segment.chars = segment.paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0);
    segment.pages = [...new Set(segment.paragraphs.flatMap((paragraph) => paragraph.pages))].sort((a, b) => a - b);
    segment.container = segment.chars === 0;
    segment.windows = buildWindows(segment.paragraphs, maxChars, overlapChars);
    segment.id = sha256(`${documentSha}|${segment.order}|${segment.title ?? ""}|${segment.numbering ?? ""}`).slice(0, 16);
  }

  const warnings: string[] = [];
  if (input.length && headings === 0) warnings.push("O documento não tem títulos reconhecíveis: o conteúdo foi tratado como um único trecho sem estrutura.");
  const chars = segments.reduce((total, segment) => total + segment.chars, 0);
  return { documentId, segments, ignored, warnings, stats: { paragraphs: input.length, segments: segments.length, headings, chars } };
}
