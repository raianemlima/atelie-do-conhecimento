import { NOISE_RULES, REVIEW_RULES, freshPattern, type NoiseCategory, type NoiseRule } from "@/lib/cleaning/rules";
import { splitSentences } from "@/lib/cleaning/sentences";
import { collapseSpaces, joinLines } from "@/lib/extraction/text-utils";
import type { DocumentExtraction, LayoutBlock } from "@/lib/extraction/types";

export const CLEANER_VERSION = "2";
const MAX_SAMPLES = 100;

export type CleanOptions = { knownTerms?: string[] };
export type CleanParagraph = { text: string; pages: number[]; kind: "body" | "table" | "footnote"; heading: boolean };
export type AmbiguousItem = { reason: "repeated_short_text" | "course_structure_marker" | "possible_professor_mention" | "unique_header_footer_text"; text: string; pages: number[] };
export type RemovalSample = { category: string; page: number; text: string };
export type CleaningResult = {
  version: string;
  paragraphs: CleanParagraph[];
  text: string;
  removed: { category: string; count: number }[];
  samples: RemovalSample[];
  ambiguous: AmbiguousItem[];
  learnedTerms: string[];
  warnings: string[];
  stats: { pages: number; inputChars: number; outputChars: number };
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const test = (rule: NoiseRule, text: string) => new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(text);
const inlineRules = NOISE_RULES.filter((rule) => rule.scope === "inline");
const sentenceRules = NOISE_RULES.filter((rule) => rule.scope === "sentence" || rule.category === "ai_talk");
const lineRules = NOISE_RULES.filter((rule) => rule.scope === "line" && rule.category === "page_number");

function frequencyKey(text: string): string {
  let out = text;
  for (const rule of inlineRules) out = out.replace(freshPattern(rule.pattern), " ");
  return collapseSpaces(out).toLowerCase().replace(/\d+/g, "#").replace(/[^\p{L}#]+/gu, " ").trim();
}

function tidy(text: string): string {
  return collapseSpaces(text)
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([,;:])\s*([.!?])/g, "$2")
    .replace(/,\s*,+/g, ",")
    .replace(/^[\s,;:.\-–—|]+/, "")
    .replace(/[\s,;:\-–—|]+$/, (tail) => (/[.!?]/.test(text.trimEnd().slice(-1)) ? tail : ""))
    .trim();
}

const hasContent = (text: string) => /[\p{L}\d]/u.test(text);

class Recorder {
  readonly counts = new Map<string, number>();
  readonly samples: RemovalSample[] = [];
  add(category: string, page: number, text: string) {
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
    if (this.samples.length < MAX_SAMPLES) this.samples.push({ category, page, text: collapseSpaces(text).slice(0, 120) });
  }
}

function hasHardNoise(text: string, knownTerms: RegExp[]): NoiseCategory | null {
  for (const rule of NOISE_RULES) { if (rule.scope !== "line" && test(rule, text)) return rule.category; }
  return knownTerms.some((term) => term.test(text)) ? "known_term" : null;
}

function cleanText(text: string, page: number, recorder: Recorder, knownTerms: RegExp[]): string {
  let out = text;
  let changed = false;
  for (const rule of inlineRules) out = out.replace(freshPattern(rule.pattern), (match) => { if (match.trim()) { recorder.add(rule.category, page, match); changed = true; } return " "; });
  for (const term of knownTerms) out = out.replace(new RegExp(term.source, "gi"), (match) => { recorder.add("known_term", page, match); changed = true; return " "; });
  const sentences = splitSentences(collapseSpaces(out));
  const kept = sentences.filter((sentence) => {
    const rule = sentenceRules.find((candidate) => test(candidate, sentence));
    if (rule) { recorder.add(rule.category, page, sentence); changed = true; }
    return !rule;
  });
  // Sem remoções, o texto sai exatamente como entrou (só espaços normalizados): citações não podem ser alteradas.
  return changed ? tidy(kept.join(" ")) : collapseSpaces(text);
}

type Entry = { block: LayoutBlock; page: number };

export function cleanDocument(extraction: DocumentExtraction, options: CleanOptions = {}): CleaningResult {
  const recorder = new Recorder();
  const knownTerms = (options.knownTerms ?? []).map((term) => term.trim()).filter(Boolean).map((term) => new RegExp(`\\b${escape(term)}\\b`, "i"));
  const entries: Entry[] = extraction.pages.flatMap((page) => page.blocks.map((block) => ({ block, page: page.page })));
  const pageCount = extraction.pages.length;

  const zoneKeys = new Map<string, Set<number>>();
  for (const { block, page } of entries) {
    if (block.kind !== "header" && block.kind !== "footer") continue;
    const key = frequencyKey(block.text);
    zoneKeys.set(key, (zoneKeys.get(key) ?? new Set()).add(page));
  }
  const threshold = pageCount >= 2 ? Math.max(2, Math.ceil(pageCount * 0.4)) : Number.POSITIVE_INFINITY;
  const learned = new Set<string>();
  const ambiguous: AmbiguousItem[] = [];
  const paragraphs: CleanParagraph[] = [];
  let inputChars = 0;

  for (const { block, page } of entries) {
    inputChars += block.text.length;
    const zone = block.kind === "header" || block.kind === "footer";
    if (zone) {
      const repeated = (zoneKeys.get(frequencyKey(block.text))?.size ?? 0) >= threshold;
      const noisy = lineRules.some((rule) => test(rule, block.text)) || hasHardNoise(block.text, knownTerms);
      if (repeated || noisy) {
        recorder.add(repeated ? `running_${block.kind}` : String(noisy), page, block.text);
        for (const phrase of block.text.match(/(?:[A-ZÁ-Ú][\wÀ-ú]+\s+){1,4}[A-ZÁ-Ú][\wÀ-ú]+/g) ?? []) if (learned.size < 20) learned.add(phrase.trim());
        continue;
      }
    }
    if (lineRules.some((rule) => test(rule, block.text))) { recorder.add("page_number", page, block.text); continue; }
    if (block.kind === "table") {
      const rows = block.text.split("\n").map((row) => cleanText(row, page, recorder, knownTerms).replace(/^\|\s*|\s*\|$/g, "")).filter(hasContent);
      if (rows.length) paragraphs.push({ text: rows.join("\n"), pages: [page], kind: "table", heading: false });
      continue;
    }
    const text = cleanText(block.text, page, recorder, knownTerms);
    if (!hasContent(text)) continue;
    if (zone && !block.heading && text.length <= 60) ambiguous.push({ reason: "unique_header_footer_text", text, pages: [page] });
    paragraphs.push({ text, pages: [page], kind: block.kind === "footnote" ? "footnote" : "body", heading: block.heading });
  }

  const merged: CleanParagraph[] = [];
  for (const paragraph of paragraphs) {
    const previous = merged[merged.length - 1];
    const continues = previous && previous.kind === "body" && paragraph.kind === "body" && !previous.heading && !paragraph.heading
      && !/[.!?:;”"')\]]$/.test(previous.text) && /^[a-zà-úç]/.test(paragraph.text) && paragraph.pages[0] === previous.pages[previous.pages.length - 1] + 1;
    if (continues) { previous.text = joinLines([previous.text, paragraph.text]); previous.pages = [...new Set([...previous.pages, ...paragraph.pages])]; }
    else merged.push({ ...paragraph, pages: [...paragraph.pages] });
  }

  const shortCount = new Map<string, { text: string; pages: Set<number> }>();
  for (const paragraph of merged) {
    if (paragraph.kind !== "body" || paragraph.text.length > 70) continue;
    const key = paragraph.text.toLowerCase().replace(/\d+/g, "#");
    const entry = shortCount.get(key) ?? { text: paragraph.text, pages: new Set<number>() };
    paragraph.pages.forEach((page) => entry.pages.add(page));
    shortCount.set(key, entry);
  }
  for (const entry of shortCount.values()) if (entry.pages.size >= 2) ambiguous.push({ reason: "repeated_short_text", text: entry.text, pages: [...entry.pages] });
  for (const paragraph of merged) {
    for (const rule of REVIEW_RULES) {
      if (rule.pattern.test(paragraph.text) && (rule.reason === "possible_professor_mention" || paragraph.text.length <= 60)) ambiguous.push({ reason: rule.reason, text: paragraph.text.slice(0, 160), pages: paragraph.pages });
    }
  }

  const text = merged.map((paragraph) => paragraph.text).join("\n\n");
  const warnings = extraction.warnings.map((warning) => warning.message);
  return {
    version: CLEANER_VERSION,
    paragraphs: merged,
    text,
    removed: [...recorder.counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category)),
    samples: recorder.samples,
    ambiguous,
    learnedTerms: [...learned],
    warnings,
    stats: { pages: pageCount, inputChars, outputChars: text.length },
  };
}
