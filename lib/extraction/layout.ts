import { collapseSpaces, joinLines } from "@/lib/extraction/text-utils";
import type { LayoutBlock, RawItem } from "@/lib/extraction/types";

type Cell = { x0: number; x1: number; text: string };
type Line = { y: number; x0: number; x1: number; fontSize: number; cells: Cell[]; text: string; chars: number; zone: "header" | "footer" | "body" };

export const HEADER_ZONE = 0.11;
export const FOOTER_ZONE = 0.09;
const MIN_COLUMN_CELL_CHARS = 25;
const GAP_FACTOR = 1.2;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildLines(items: RawItem[], pageHeight: number): Line[] {
  const real = items.filter((item) => item.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: RawItem[][] = [];
  for (const item of real) {
    const group = groups[groups.length - 1];
    const tolerance = Math.max(1, item.fontSize * 0.5);
    if (group && Math.abs(group[0].y - item.y) <= tolerance) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => a.x - b.x);
    const fontSize = Math.max(...sorted.map((item) => item.fontSize));
    const cells: Cell[] = [];
    for (const item of sorted) {
      const last = cells[cells.length - 1];
      const gap = last ? item.x - last.x1 : 0;
      if (!last || gap > fontSize * GAP_FACTOR) cells.push({ x0: item.x, x1: item.x + item.width, text: item.text.trim() });
      else { last.text += (gap > fontSize * 0.15 || /\s$/.test(last.text) ? " " : "") + item.text.trim(); last.x1 = Math.max(last.x1, item.x + item.width); }
    }
    cells.forEach((cell) => { cell.text = collapseSpaces(cell.text); });
    const y = group[0].y;
    const zone = y > pageHeight * (1 - HEADER_ZONE) ? "header" : y < pageHeight * FOOTER_ZONE ? "footer" : "body";
    const text = cells.map((cell) => cell.text).join(" ");
    return { y, x0: cells[0].x0, x1: cells[cells.length - 1].x1, fontSize, cells, text, chars: text.replace(/\s/g, "").length, zone };
  });
}

type Gutter = { x: number };

function findGutter(lines: Line[], width: number): Gutter | null {
  if (lines.length < 4) return null;
  let best: { x: number; crossing: number } | null = null;
  for (let x = width * 0.3; x <= width * 0.7; x += 2) {
    const crossing = lines.filter((line) => line.cells.some((cell) => cell.x0 < x && cell.x1 > x)).length;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  if (!best || best.crossing / lines.length > 0.2) return null;
  const left = lines.flatMap((line) => line.cells.filter((cell) => cell.x1 <= best.x));
  const right = lines.flatMap((line) => line.cells.filter((cell) => cell.x0 >= best.x));
  const longCells = (cells: Cell[]) => cells.length >= 2 && median(cells.map((cell) => cell.text.length)) >= MIN_COLUMN_CELL_CHARS;
  const sides = lines.filter((line) => line.cells.some((c) => c.x1 <= best.x) && line.cells.some((c) => c.x0 >= best.x)).length;
  if (!longCells(left) || !longCells(right) || sides < 2) return null;
  return { x: best.x };
}

type Segment = { lines: Line[]; column: 0 | 1 | null };

function splitIntoStreams(lines: Line[], gutter: Gutter | null): Segment[] {
  if (!gutter) return [{ lines, column: null }];
  const segments: Segment[] = [];
  let run: Line[] = [];
  const flush = () => {
    if (!run.length) return;
    const side = (pick: (cell: Cell) => boolean) => run.map((line) => { const cells = line.cells.filter(pick); return cells.length ? { ...line, cells, text: cells.map((c) => c.text).join(" "), x0: cells[0].x0, x1: cells[cells.length - 1].x1 } : null; }).filter((line): line is Line => line !== null);
    segments.push({ lines: side((cell) => cell.x1 <= gutter.x), column: 0 }, { lines: side((cell) => cell.x0 >= gutter.x), column: 1 });
    run = [];
  };
  for (const line of lines) {
    if (line.cells.some((cell) => cell.x0 < gutter.x && cell.x1 > gutter.x)) { flush(); segments.push({ lines: [line], column: null }); }
    else run.push(line);
  }
  flush();
  return segments;
}

function lowerQuartile(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor((sorted.length - 1) * 0.25)];
}

// Itens que abrem um parágrafo próprio em texto jurídico e em listas, mesmo sem espaço extra entre as linhas.
const NEW_ITEM = /^(?:Art(?:igos?)?\.?\s*\d|§|Par[áa]grafo\s+[úu]nico|[IVXLC]{1,6}\s*[-–—)]\s|[a-z]\)\s|\d{1,2}(?:\.\d{1,2})*[.)]\s+\p{Lu})/u;

const isTabular = (line: Line) => line.cells.length >= 2 && line.cells.every((cell) => cell.text.length <= 40);
const sameColumns = (a: Line, b: Line) => a.cells.filter((cell) => b.cells.some((other) => Math.abs(other.x0 - cell.x0) <= 4)).length >= 2;

type Piece = { kind: "paragraph" | "table"; lines: Line[]; column: 0 | 1 | null };

function groupPieces(segment: Segment): Piece[] {
  const pieces: Piece[] = [];
  const lines = segment.lines;
  // Quartil inferior (não a mediana): quando a maioria dos parágrafos tem uma linha só, a mediana vira o espaço entre parágrafos.
  const spacing = lowerQuartile(lines.slice(1).map((line, i) => lines[i].y - line.y).filter((gap) => gap > 0));
  let current: Piece | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const previous = lines[i - 1];
    const tabular = isTabular(line) && ((previous && isTabular(previous) && sameColumns(previous, line)) || (lines[i + 1] && isTabular(lines[i + 1]) && sameColumns(line, lines[i + 1])));
    if (tabular) {
      if (current?.kind === "table") current.lines.push(line);
      else { current = { kind: "table", lines: [line], column: segment.column }; pieces.push(current); }
      continue;
    }
    const gap = previous ? previous.y - line.y : 0;
    const fontShift = previous ? Math.abs(previous.fontSize - line.fontSize) / Math.max(previous.fontSize, 1) > 0.15 : false;
    const startsNew = !current || current.kind === "table" || gap > Math.max(spacing * 1.3, line.fontSize * 1.45) || fontShift || (previous !== undefined && NEW_ITEM.test(line.text));
    if (startsNew) { current = { kind: "paragraph", lines: [line], column: segment.column }; pieces.push(current); }
    else current?.lines.push(line);
  }
  return pieces;
}

export function buildLayout(items: RawItem[], page: { width: number; height: number }): LayoutBlock[] {
  const lines = buildLines(items, page.height);
  if (!lines.length) return [];
  const bodyCandidates = lines.filter((line) => line.zone === "body");
  const weighted = bodyCandidates.flatMap((line) => Array.from({ length: Math.max(1, Math.round(line.chars / 10)) }, () => line.fontSize));
  const bodyFont = median(weighted) || median(lines.map((line) => line.fontSize));
  const isFootnote = (line: Line) => line.zone === "body" && line.y < page.height * 0.4 && line.fontSize <= bodyFont * 0.88;
  const footnotes = bodyCandidates.filter(isFootnote);
  const body = bodyCandidates.filter((line) => !isFootnote(line));
  const blocks: LayoutBlock[] = [];

  const isHeadingText = (text: string, fontSize: number, lineCount: number) => (fontSize >= bodyFont * 1.15 && text.length <= 120) || (text.length <= 80 && lineCount === 1 && text === text.toUpperCase() && /[A-ZÀ-Ú]{3}/.test(text));
  for (const line of lines.filter((candidate) => candidate.zone === "header")) blocks.push({ kind: "header", text: line.text, fontSize: line.fontSize, y: line.y, column: null, heading: isHeadingText(line.text, line.fontSize, 1), source: "text-layer" });
  const gutter = findGutter(body, page.width);
  for (const segment of splitIntoStreams(body, gutter)) {
    for (const piece of groupPieces(segment)) {
      const fontSize = Math.max(...piece.lines.map((line) => line.fontSize));
      if (piece.kind === "table") {
        blocks.push({ kind: "table", text: piece.lines.map((line) => line.cells.map((cell) => cell.text).join(" | ")).join("\n"), fontSize, y: piece.lines[0].y, column: piece.column, heading: false, source: "text-layer" });
        continue;
      }
      const text = joinLines(piece.lines.map((line) => line.text));
      const heading = isHeadingText(text, fontSize, piece.lines.length);
      blocks.push({ kind: "body", text, fontSize, y: piece.lines[0].y, column: piece.column, heading, source: "text-layer" });
    }
  }
  if (footnotes.length) {
    const grouped: Line[][] = [];
    for (const line of footnotes) {
      const startsNote = /^(?:\d{1,3}|[*†‡§])\s*[.)]?\s+\S/.test(line.text);
      if (!grouped.length || startsNote) grouped.push([line]); else grouped[grouped.length - 1].push(line);
    }
    for (const group of grouped) blocks.push({ kind: "footnote", text: joinLines(group.map((line) => line.text)), fontSize: group[0].fontSize, y: group[0].y, column: null, heading: false, source: "text-layer" });
  }
  for (const line of lines.filter((candidate) => candidate.zone === "footer")) blocks.push({ kind: "footer", text: line.text, fontSize: line.fontSize, y: line.y, column: null, heading: false, source: "text-layer" });
  return blocks.filter((block) => block.text.trim());
}
