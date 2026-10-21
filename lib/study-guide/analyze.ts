import { extractCitations } from "@/lib/citations/extract";
import { endsAbruptly, splitSentences } from "@/lib/study-guide/sentences";

export type GuideSection = { heading: string | null; paragraphs: string[] };
export type ExcludedReason = "referencia" | "meta" | "fragmento" | "duplicado";
export type GuideAnalysis = { sections: GuideSection[]; keyPoints: string[]; excluded: { reason: ExcludedReason; text: string }[] };

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const letterRatio = (text: string) => (text.match(/\p{L}/gu)?.length ?? 0) / Math.max(1, text.replace(/\s/g, "").length);
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const REFERENCE_HEADING = /^(?:\d+[.)]?\s*)?(?:refer[eê]ncias?(?:\s+bibliogr[aá]ficas?)?(?:\s+utilizadas?)?|bibliografia(?:\s+\w+)?|obras? consultadas?)\s*:?$/i;
const META_HEADING = /^(?:\d+[.)]?\s*)?(?:o que vai estudar(?: neste material)?|objetivos? (?:de aprendizagem|do material)|apresenta[cç][aã]o(?: do material)?|sum[aá]rio|[ií]ndice|como (?:usar|estudar) (?:este|esse) material)\s*:?$/i;
const META_PARAGRAPH = /\b(?:(?:este|esse) material (?:foi produzido|foi elaborado|tem por|[eé] (?:um )?resumo)|material produzido com base|com base nas obras|produzido com base)\b|^ponto\s*\d+\s*:?$/i;
const NUMBERED_HEADING = /^(?:(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]|[a-z]\))\s+\S/;

function isHeading(text: string, hasNext: boolean): boolean {
  if (!hasNext) return false;
  const count = words(text).length;
  if (count === 0 || count > 14) return false;
  if (/[.!?;]$/.test(text) && !NUMBERED_HEADING.test(text)) return false;
  if (/[,]$/.test(text) || /^\p{Ll}/u.test(text)) return false;
  if (NUMBERED_HEADING.test(text) && count <= 14 && !/[.!?]$/.test(text)) return true;
  return text === text.toUpperCase() && letterRatio(text) > 0.6 ? true : count <= 9 && !/[.!?:;,]$/.test(text) && /^\p{Lu}/u.test(text) && !/\b(?:é|são|foi|foram|deve|devem)\b/i.test(text);
}

// Junta quebras de parágrafo no meio de uma frase (comum na extração de PDF) e descarta pedaços sem sentido.
function repairParagraphs(raw: string[], excluded: GuideAnalysis["excluded"]): string[] {
  const merged: string[] = [];
  for (const text of raw) {
    const previous = merged[merged.length - 1];
    if (previous && endsAbruptly(previous) && words(previous).length >= 3 && /^[\p{Ll}\d(]/u.test(text)) merged[merged.length - 1] = `${previous} ${text}`;
    else merged.push(text);
  }
  return merged.filter((text) => {
    const tooShort = words(text).length < 4 && !isHeading(text, true);
    const garbage = letterRatio(text) < 0.5 || (endsAbruptly(text) && words(text).length < 8 && /[.]$/.test(text));
    if ((tooShort && /[.]$/.test(text)) || garbage) { excluded.push({ reason: "fragmento", text }); return false; }
    return true;
  });
}

export function analyzeText(extractedText: string): GuideAnalysis {
  const excluded: GuideAnalysis["excluded"] = [];
  const raw = extractedText.split(/\n{2,}/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const paragraphs = repairParagraphs(raw, excluded);
  const sections: GuideSection[] = [];
  let current: GuideSection = { heading: null, paragraphs: [] };
  let skipping: ExcludedReason | null = null;
  const flush = () => { if (current.paragraphs.length) sections.push(current); };
  paragraphs.forEach((text, index) => {
    if (REFERENCE_HEADING.test(text)) { skipping = "referencia"; excluded.push({ reason: "referencia", text }); return; }
    if (META_HEADING.test(text)) { skipping = "meta"; excluded.push({ reason: "meta", text }); return; }
    if (isHeading(text, index < paragraphs.length - 1)) { skipping = null; flush(); current = { heading: text.replace(/^(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]\s*/, ""), paragraphs: [] }; return; }
    if (skipping) { excluded.push({ reason: skipping, text }); return; }
    if (META_PARAGRAPH.test(text) || /^refer[eê]ncias bibliogr[aá]ficas/i.test(text)) { excluded.push({ reason: /refer[eê]ncias|obras/i.test(text) ? "referencia" : "meta", text }); return; }
    current.paragraphs.push(text);
  });
  flush();
  return { sections, keyPoints: selectKeyPoints(sections), excluded };
}

const DEFINITION = /\b(?:é|são|consiste|consideram?-se|considera-se|compreende|define-se|denomina-se|caracteriza-se|entende-se|corresponde|configura)\b/i;
const DOCTRINE = /\b(?:STF|STJ|S[uú]mula|tese|entendimento|jurisprud[eê]ncia|prevalece|majorit[aá]ri[ao]|vedad[ao]|admite-se|cab[ií]vel|incab[ií]vel|legitimidade|requisito|prazo|compet[eê]ncia)\b/;
const OPENERS = /^(?:ponto\s*\d|este material|esse material|veja|observe|lembre-se|atenção)/i;

function score(sentence: string, firstOfParagraph: boolean): number {
  const count = words(sentence).length;
  if (count < 8 || count > 55 || letterRatio(sentence) < 0.6 || endsAbruptly(sentence) || !/^[\p{Lu}"“]/u.test(sentence) || OPENERS.test(sentence)) return -Infinity;
  let value = 0;
  if (DEFINITION.test(sentence)) value += 3;
  if (DOCTRINE.test(sentence)) value += 3;
  if (extractCitations(sentence).length > 0) value += 2;
  if (firstOfParagraph) value += 1;
  if (count >= 12 && count <= 35) value += 1;
  return value;
}

const similarity = (a: string, b: string) => {
  const x = new Set(plain(a).split(/\W+/).filter((w) => w.length > 3));
  const y = new Set(plain(b).split(/\W+/).filter((w) => w.length > 3));
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size));
};

export function selectKeyPoints(sections: GuideSection[], limit = 10): string[] {
  const candidates = sections.flatMap((section, sectionIndex) => section.paragraphs.flatMap((paragraph, p) => splitSentences(paragraph).map((sentence, s) => ({ sentence, sectionIndex, order: sectionIndex * 100000 + p * 100 + s, value: score(sentence, s === 0) }))));
  const viable = candidates.filter((candidate) => candidate.value >= 3);
  const total = candidates.filter((candidate) => Number.isFinite(candidate.value)).length;
  const target = Math.min(limit, Math.max(3, Math.ceil(total / 8)));
  const chosen: typeof viable = [];
  const perSection = new Map<number, number>();
  const sectionCap = Math.max(2, Math.ceil(target / Math.max(1, sections.length)));
  for (const candidate of [...viable].sort((a, b) => b.value - a.value || a.order - b.order)) {
    if (chosen.length >= target) break;
    if ((perSection.get(candidate.sectionIndex) ?? 0) >= sectionCap) continue;
    if (chosen.some((other) => similarity(other.sentence, candidate.sentence) > 0.7)) continue;
    chosen.push(candidate);
    perSection.set(candidate.sectionIndex, (perSection.get(candidate.sectionIndex) ?? 0) + 1);
  }
  return chosen.sort((a, b) => a.order - b.order).map((candidate) => candidate.sentence);
}
