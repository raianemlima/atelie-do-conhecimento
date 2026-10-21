import { extractCitations } from "@/lib/citations/extract";
import { intToRoman, matchDiploma, romanToInt } from "@/lib/citations/diplomas";
import { KIND_ORDER, type Citation, type CitationKind, type CitationRegistry, type Divergence, type ExtractedCitation, type Occurrence } from "@/lib/citations/types";
import { sha256 } from "@/lib/pipeline/hash";
import type { Segment, SegmentationResult } from "@/lib/segmentation/types";

export type RegistryInput = { documents: { id: string; title: string }[]; segmentations: SegmentationResult[] };

const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const normalizeStatement = (value: string) => plain(value).replace(/[^\p{L}\d ]/gu, " ").replace(/\s+/g, " ").trim();
const MAX_VARIANTS = 20;

// Texto de lei, súmula ou tese só é comparável se um contiver o outro (citação parcial); qualquer outra diferença é divergência.
export const statementsCompatible = (a: string, b: string) => {
  const x = normalizeStatement(a);
  const y = normalizeStatement(b);
  return x === y || x.includes(y) || y.includes(x);
};

function diplomaFromTitle(title: string): { id: string; label: string } | null {
  for (let i = 0; i < title.length; i += 1) {
    if (i > 0 && /[\p{L}\d]/u.test(title[i - 1])) continue;
    const found = matchDiploma(title.slice(i).replace(/[-_]+/g, " "));
    if (found) return found.diploma;
  }
  return null;
}

const SUB_ELEMENT = /^(?:§\s*(\d+)\s*(?:[º°]|o(?![\p{L}\d]))?|(Par[áa]grafo\s+[úu]nico)|([IVXLCDM]{1,7})\s*[-–—)]|([a-z])\))\s*[.:–—-]?\s*/iu;

type LawContext = { item: ExtractedCitation; paragraph: string | null; inciso: number | null };

function relabel(item: ExtractedCitation, parts: { paragraph: string | null; inciso: number | null; alinea: string | null }): { key: string; label: string; fields: ExtractedCitation["fields"] } {
  const base = item.key.split("|").filter((part) => !/^(?:par|inc|ali):/.test(part));
  const key = [...base, parts.paragraph ? `par:${parts.paragraph}` : null, parts.inciso ? `inc:${parts.inciso}` : null, parts.alinea ? `ali:${parts.alinea}` : null].filter(Boolean).join("|");
  const head = String(item.label).split(",")[0];
  const article = String(item.fields.article);
  const label = [`${head}, art. ${/^\d+$/.test(article) && Number(article) <= 9 ? `${article}º` : article}`, parts.paragraph ? (parts.paragraph === "u" ? "parágrafo único" : `§ ${parts.paragraph}º`) : null, parts.inciso ? `inciso ${intToRoman(parts.inciso)}` : null, parts.alinea ? `alínea ${parts.alinea}` : null].filter(Boolean).join(", ");
  return { key, label, fields: { ...item.fields, paragraph: parts.paragraph, inciso: parts.inciso, alinea: parts.alinea } };
}

function applyDiplomaHint(item: ExtractedCitation, hint: { id: string; label: string } | null): ExtractedCitation {
  if (!hint || item.kind !== "law" || item.fields.diploma !== null) return item;
  return { ...item, key: item.key.replace("law|?|", `law|${hint.id}|`), label: item.label.replace("(diploma não identificado)", hint.label), fields: { ...item.fields, diploma: hint.id, diplomaLabel: hint.label, ambiguous: false } };
}

// Extrai as citações de um segmento, incluindo o TEXTO de artigos/incisos/parágrafos quando o documento é o próprio texto de lei.
export function citationsOfSegment(segment: Segment, hint: { id: string; label: string } | null): { paragraph: number; item: ExtractedCitation }[] {
  const found: { paragraph: number; item: ExtractedCitation }[] = [];
  let context: LawContext | null = null;
  segment.paragraphs.forEach((paragraph, index) => {
    const text = paragraph.text;
    const items = extractCitations(text).map((item) => applyDiplomaHint(item, hint));
    const head = items.find((item) => item.kind === "law" && item.start === 0 && item.fields.article !== null && item.fields.diploma === (hint?.id ?? null));
    if (head) {
      const separator = /^\s*[-–—:.]\s*/.exec(text.slice(head.end));
      const remainder = text.slice(head.end + (separator?.[0].length ?? 0)).trim();
      const styled = Boolean(separator) || /^\s+\p{Lu}/u.test(text.slice(head.end));
      if (remainder.length >= 10 && styled) head.statement = remainder;
      context = { item: head, paragraph: head.fields.paragraph as string | null, inciso: head.fields.inciso as number | null };
    } else if (context) {
      const sub = SUB_ELEMENT.exec(text);
      if (sub) {
        const rest = text.slice(sub[0].length).trim();
        let parts: { paragraph: string | null; inciso: number | null; alinea: string | null };
        if (sub[1] || sub[2]) { context.paragraph = sub[2] ? "u" : sub[1]; context.inciso = null; parts = { paragraph: context.paragraph, inciso: null, alinea: null }; }
        else if (sub[3] && romanToInt(sub[3].toUpperCase())) { context.inciso = romanToInt(sub[3].toUpperCase()); parts = { paragraph: context.paragraph, inciso: context.inciso, alinea: null }; }
        else if (sub[4]) parts = { paragraph: context.paragraph, inciso: context.inciso, alinea: sub[4].toLowerCase() };
        else { context = null; parts = { paragraph: null, inciso: null, alinea: null }; }
        if (context && rest.length >= 3) {
          const meta = relabel(context.item, parts);
          found.push({ paragraph: index, item: { kind: "law", ...meta, raw: sub[0].trim(), start: 0, end: sub[0].length, statement: rest } });
        }
      } else context = null;
    }
    items.forEach((item) => found.push({ paragraph: index, item }));
  });
  return found;
}

function comparable(citation: Citation): Divergence[] {
  const divergences: Divergence[] = [];
  const byDoc = new Map<string, string>();
  citation.statements.forEach((statement) => { if (!byDoc.has(`${statement.documentId}|${normalizeStatement(statement.text)}`)) byDoc.set(`${statement.documentId}|${normalizeStatement(statement.text)}`, statement.text); });
  const statements = citation.statements.filter((statement, index, all) => all.findIndex((other) => other.documentId === statement.documentId && normalizeStatement(other.text) === normalizeStatement(statement.text)) === index);
  const conflicting = statements.some((a, i) => statements.slice(i + 1).some((b) => a.documentId !== b.documentId && !statementsCompatible(a.text, b.text)));
  if (conflicting) divergences.push({ field: "statement", values: statements.map((s) => ({ documentId: s.documentId, value: s.text })) });
  if (citation.kind === "case") {
    for (const field of ["relator", "judgedAt", "publishedAt", "body"] as const) {
      const values = citation.occurrences.flatMap((occurrence) => (occurrence.detail?.[field] ? [{ documentId: occurrence.documentId, value: occurrence.detail[field] }] : []));
      const distinct = new Map(values.map((entry) => [plain(entry.value).replace(/\s+/g, " "), entry]));
      const documents = new Set(values.map((entry) => entry.documentId));
      if (distinct.size > 1 && documents.size > 1) divergences.push({ field, values: [...new Map(values.map((entry) => [`${entry.documentId}|${plain(entry.value)}`, entry])).values()] });
    }
  }
  return divergences;
}

const lawSort = (a: Citation, b: Citation) => String(a.fields.diplomaLabel ?? "~").localeCompare(String(b.fields.diplomaLabel ?? "~"), "pt-BR") || a.label.localeCompare(b.label, "pt-BR", { numeric: true });

export function buildCitationRegistry(input: RegistryInput): CitationRegistry {
  const titleOf = (id: string) => input.documents.find((document) => document.id === id)?.title ?? id;
  const map = new Map<string, Citation>();
  const warnings: string[] = [];
  for (const segmentation of input.segmentations) {
    const hint = diplomaFromTitle(titleOf(segmentation.documentId));
    let count = 0;
    for (const segment of segmentation.segments) {
      for (const { paragraph, item } of citationsOfSegment(segment, hint)) {
        count += 1;
        const paragraphData = segment.paragraphs[paragraph];
        let citation = map.get(item.key);
        if (!citation) {
          citation = { id: sha256(item.key).slice(0, 12), kind: item.kind, key: item.key, label: item.label, fields: item.fields, occurrences: [], variants: [], documentIds: [], statements: [], divergences: [] };
          map.set(item.key, citation);
        }
        const occurrence: Occurrence = { documentId: segmentation.documentId, segmentId: segment.id, paragraph, pages: paragraphData.pages, raw: item.raw, start: item.start, end: item.end, ...(item.detail ? { detail: item.detail } : {}) };
        citation.occurrences.push(occurrence);
        if (!citation.variants.includes(item.raw) && citation.variants.length < MAX_VARIANTS) citation.variants.push(item.raw);
        if (!citation.documentIds.includes(segmentation.documentId)) citation.documentIds.push(segmentation.documentId);
        if (item.statement && !citation.statements.some((s) => s.documentId === segmentation.documentId && s.text === item.statement)) citation.statements.push({ documentId: segmentation.documentId, text: item.statement });
      }
    }
    if (count === 0 && segmentation.segments.some((segment) => segment.chars > 0)) warnings.push(`"${titleOf(segmentation.documentId)}" não tem citações jurídicas reconhecidas.`);
  }
  const citations = [...map.values()];
  citations.forEach((citation) => { citation.divergences = comparable(citation); });
  citations.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.kind === "law" ? lawSort(a, b) : a.label.localeCompare(b.label, "pt-BR", { numeric: true })));
  const byKind = Object.fromEntries(KIND_ORDER.map((kind) => [kind, citations.filter((citation) => citation.kind === kind).length])) as Record<CitationKind, number>;
  const ambiguous = citations.filter((citation) => citation.fields.ambiguous === true).length;
  if (ambiguous) warnings.push(`${ambiguous} citação(ões) não identificam o diploma (ex.: "art. 5º" sem dizer de qual lei). Elas não são unificadas com citações de diploma conhecido.`);
  return { schema: 1, documents: input.documents, citations, warnings, stats: { total: citations.length, byKind, divergent: citations.filter((citation) => citation.divergences.length).length, ambiguousDiploma: ambiguous, multiSource: citations.filter((citation) => citation.documentIds.length > 1).length } };
}
