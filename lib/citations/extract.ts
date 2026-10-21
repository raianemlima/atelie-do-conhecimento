import { splitSentences } from "@/lib/cleaning/sentences";
import { expandYear, intToRoman, matchDiploma, NUMBERED_DIPLOMA, romanToInt, type Diploma } from "@/lib/citations/diplomas";
import { sha256 } from "@/lib/pipeline/hash";
import type { ExtractedCitation } from "@/lib/citations/types";

const ORD = String.raw`(?:[º°]|o(?![\p{L}\d]))?`;
const COURTS = "STF|STJ|TST|TSE|STM|TCU";
const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const number = (digits: string) => String(Number(digits.replace(/\./g, "")));

type Span = [number, number];
class Taken {
  private readonly spans: Span[] = [];
  overlaps(start: number, end: number) { return this.spans.some(([a, b]) => start < b && end > a); }
  add(start: number, end: number) { this.spans.push([start, end]); }
}

const sticky = (pattern: string, flags = "iy") => new RegExp(pattern, flags);
const TAIL_RULES: { name: "paragraph" | "unique" | "caput" | "inciso" | "bare" | "alinea"; re: RegExp }[] = [
  { name: "unique", re: sticky(String.raw`\s*,?\s*par[áa]grafo\s+[úu]nico`) },
  { name: "paragraph", re: sticky(String.raw`\s*,?\s*(?:§§?|par[áa]grafos?)\s*(\d+)\s*${ORD}`) },
  { name: "caput", re: sticky(String.raw`\s*,?\s*caput(?![\p{L}])`, "iuy") },
  { name: "inciso", re: sticky(String.raw`\s*,?\s*(?:incisos?|inc\.)\s*([IVXLCDM]+|\d+)(?![\p{L}\d])`, "iuy") },
  { name: "bare", re: sticky(String.raw`\s*,\s*([IVXLCDM]{1,7})(?![\p{L}\d])`, "uy") },
  { name: "alinea", re: sticky(String.raw`\s*,?\s*(?:al[íi]neas?|al\.)\s*["“']?([a-z])["”']?(?![\p{L}\d])`, "iuy") },
];

type Tail = { end: number; paragraph: string | null; inciso: number | null; alinea: string | null };

function parseTail(text: string, from: number): Tail {
  const tail: Tail = { end: from, paragraph: null, inciso: null, alinea: null };
  for (let guard = 0; guard < 6; guard += 1) {
    let advanced = false;
    for (const rule of TAIL_RULES) {
      rule.re.lastIndex = tail.end;
      const match = rule.re.exec(text);
      if (!match) continue;
      if (rule.name === "unique" && tail.paragraph === null) tail.paragraph = "u";
      else if (rule.name === "paragraph" && tail.paragraph === null) tail.paragraph = match[1];
      else if ((rule.name === "inciso" || rule.name === "bare") && tail.inciso === null) tail.inciso = /^\d+$/.test(match[1]) ? Number(match[1]) : romanToInt(match[1]);
      else if (rule.name === "alinea" && tail.alinea === null) tail.alinea = match[1].toLowerCase();
      else if (rule.name !== "caput") continue;
      if (rule.name === "bare" && tail.inciso === null) continue;
      tail.end = rule.re.lastIndex;
      advanced = true;
      break;
    }
    if (!advanced) break;
  }
  return tail;
}

const ALIAS = /^\s*\([A-Za-z\/. ]{2,14}\)/;
const AFTER_CONNECTOR = /^(?:\s*,\s*|\s+)(?:(?:d[aoe]s?|n[oa]s?)\s+)?/i;

function diplomaAfter(text: string, pos: number): { diploma: Diploma; end: number } | null {
  const connector = AFTER_CONNECTOR.exec(text.slice(pos));
  if (!connector) return null;
  const start = pos + connector[0].length;
  const found = matchDiploma(text.slice(start));
  if (!found) return null;
  let end = start + found.length;
  const alias = ALIAS.exec(text.slice(end));
  if (alias) end += alias[0].length;
  return { diploma: found.diploma, end };
}

function diplomaBefore(text: string, head: number, taken: Taken): { diploma: Diploma; start: number } | null {
  const lookbehind = text.slice(Math.max(0, head - 90), head);
  const base = head - lookbehind.length;
  for (let k = 0; k < lookbehind.length; k += 1) {
    if (k > 0 && /[\p{L}\d]/u.test(lookbehind[k - 1])) continue;
    const found = matchDiploma(lookbehind.slice(k));
    if (!found) continue;
    let end = k + found.length;
    const alias = ALIAS.exec(lookbehind.slice(end));
    if (alias) end += alias[0].length;
    // Um diploma já usado por outra citação (ex.: "art. 186 do Código Civil, art. 5…") não pertence a esta.
    if (/^\s*[,–-]?\s*$/.test(lookbehind.slice(end)) && !taken.overlaps(base + k, base + end)) return { diploma: found.diploma, start: base + k };
  }
  return null;
}

const ordinal = (article: string) => (/^\d+$/.test(article) && Number(article) <= 9 ? `${article}º` : article);

function lawItem(diploma: Diploma | null, article: string, tail: Tail, raw: string, start: number, end: number): ExtractedCitation {
  const key = ["law", diploma?.id ?? "?", `art:${article.toLowerCase()}`, tail.paragraph ? `par:${tail.paragraph}` : null, tail.inciso ? `inc:${tail.inciso}` : null, tail.alinea ? `ali:${tail.alinea}` : null].filter(Boolean).join("|");
  const parts = [`art. ${ordinal(article)}`, tail.paragraph ? (tail.paragraph === "u" ? "parágrafo único" : `§ ${tail.paragraph}º`) : null, tail.inciso ? `inciso ${intToRoman(tail.inciso)}` : null, tail.alinea ? `alínea ${tail.alinea}` : null].filter(Boolean).join(", ");
  return { kind: "law", key, label: `${diploma?.label ?? "(diploma não identificado)"}, ${parts}`, fields: { diploma: diploma?.id ?? null, diplomaLabel: diploma?.label ?? null, article, paragraph: tail.paragraph, inciso: tail.inciso, alinea: tail.alinea, ambiguous: diploma === null }, raw, start, end };
}

function extractArticles(text: string, taken: Taken, out: ExtractedCitation[]) {
  const head = new RegExp(String.raw`\b(Art(?:igos?|s)?)\.?\s*(\d{1,4}(?:\.\d{3})*(?:-[A-Z])?)${ORD}`, "giu");
  for (const match of text.matchAll(head)) {
    const start = match.index ?? 0;
    let cursor = start + match[0].length;
    if (taken.overlaps(start, cursor)) continue;
    const plural = /^Art(?:igos|s)$/i.test(match[1]);
    const articles = [match[2].replace(/\./g, "")];
    while (plural) {
      const more = new RegExp(String.raw`\s*(?:,|e|a)\s*(\d{1,4}(?:\.\d{3})*)${ORD}`, "iuy");
      more.lastIndex = cursor;
      const next = more.exec(text);
      if (!next) break;
      articles.push(next[1].replace(/\./g, ""));
      cursor = more.lastIndex;
    }
    const tail = parseTail(text, cursor);
    const after = diplomaAfter(text, tail.end);
    const before = after ? null : diplomaBefore(text, start, taken);
    const diploma = after?.diploma ?? before?.diploma ?? null;
    const first = before ? before.start : start;
    const end = after ? after.end : tail.end;
    const raw = text.slice(first, end);
    articles.forEach((article, index) => out.push(lawItem(diploma, article, index === articles.length - 1 ? tail : { end: tail.end, paragraph: null, inciso: null, alinea: null }, raw, first, end)));
    taken.add(first, end);
  }
}

function extractBareLaws(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(NUMBERED_DIPLOMA.source.replace(/^\^/, "\\b"), "giu");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken.overlaps(start, end)) continue;
    const found = matchDiploma(match[0]);
    if (!found) continue;
    out.push({ kind: "law", key: `law|${found.diploma.id}`, label: found.diploma.label, fields: { diploma: found.diploma.id, diplomaLabel: found.diploma.label, article: null, paragraph: null, inciso: null, alinea: null, ambiguous: false }, raw: match[0], start, end });
    taken.add(start, end);
  }
}

const firstSentence = (value: string) => (splitSentences(value.trim())[0] ?? "").replace(/^["“”']+|["“”']+$/g, "").trim();

function statementAfter(text: string, end: number): string | undefined {
  const match = /^\s*[:–—-]\s*([\s\S]+)$/u.exec(text.slice(end));
  const value = match ? firstSentence(match[1]) : "";
  return value || undefined;
}

function extractSumulas(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(String.raw`\bS[úu]mulas?\s+(Vinculante\s+)?(?:n[º°o.]*\s*)?(\d{1,4})(?:(?:\s*\/\s*|\s*,\s*|\s+(?:d[oa]s?|de)\s+|\s+)(${COURTS})\b)?`, "giu");
  for (const match of text.matchAll(pattern)) {
    let start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken.overlaps(start, end)) continue;
    let court = match[3]?.toUpperCase() ?? null;
    const binding = Boolean(match[1]);
    if (!court && !binding) {
      const before = new RegExp(String.raw`(${COURTS})\s*[,:–-]?\s*$`, "u").exec(text.slice(Math.max(0, start - 12), start));
      if (before) { court = before[1]; start -= before[0].length; }
    }
    if (binding) court = "STF";
    const n = number(match[2]);
    out.push({ kind: "sumula", key: binding ? `sv:${n}` : `sumula:${court ?? "?"}:${n}`, label: binding ? `Súmula Vinculante ${n}` : `Súmula ${n}${court ? ` do ${court}` : ""}`, fields: { court, number: Number(n), binding, ambiguous: court === null }, raw: text.slice(start, end), start, end, statement: statementAfter(text, end) });
    taken.add(start, end);
  }
}

const CASE_COURT: Record<string, string | null> = { REsp: "STJ", AREsp: "STJ", EREsp: "STJ", RE: "STF", ARE: "STF", ADI: "STF", ADC: "STF", ADPF: "STF", ADO: "STF", Rcl: "STF", RvCr: null, HC: null, RHC: null, MS: null, RMS: null, Pet: null, SS: null, STA: null };

function extractCases(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(String.raw`(?:\b(AgRg|AgInt|AgR|EDcl|ED)\s+(?:no|na|nos|nas|em)\s+)*\b(REsp|AREsp|EREsp|RE|ARE|ADI|ADC|ADPF|ADO|HC|RHC|MS|RMS|Rcl|RvCr|Pet|SS|STA)\s*(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{3,7})(?:\s*[\/-]\s*([A-Z]{2})\b)?`, "gu");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken.overlaps(start, end)) continue;
    const klass = match[2];
    const digits = number(match[3]);
    const near = new RegExp(String.raw`\b(STF|STJ)\b`, "u").exec(text.slice(Math.max(0, start - 60), Math.min(text.length, end + 120)));
    const court = CASE_COURT[klass] ?? near?.[1] ?? null;
    out.push({ kind: "case", key: `case|${klass}|${digits}${CASE_COURT[klass] === null ? `|${court ?? "?"}` : ""}`, label: `${klass} ${Number(digits).toLocaleString("pt-BR")}${match[4] ? `/${match[4]}` : ""}`, fields: { class: klass, number: digits, uf: match[4] ?? null, court, incident: /^(AgRg|AgInt|AgR|EDcl|ED)/.test(match[0]) ? match[0].split(/\s/)[0] : null }, raw: match[0], start, end });
    taken.add(start, end);
  }
}

function extractThemes(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(String.raw`\bTema\s*(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:(?:\s*\/\s*|\s*,\s*|\s+(?:d[oa]s?|de)\s+|\s+)(STF|STJ)\b)?`, "giu");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken.overlaps(start, end)) continue;
    const around = text.slice(Math.max(0, start - 50), Math.min(text.length, end + 60));
    let court = match[2]?.toUpperCase() ?? null;
    if (!court && /repercuss[ãa]o\s+geral/i.test(around)) court = "STF";
    if (!court && /repetitiv|IRDR|IAC/i.test(around)) court = "STJ";
    if (!court) continue;
    const n = number(match[1]);
    out.push({ kind: "theme", key: `theme|${court}|${n}`, label: `Tema ${n} (${court})`, fields: { court, number: Number(n) }, raw: match[0], start, end });
    taken.add(start, end);
  }
}

function extractInformativos(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(String.raw`\bInformativo\s*(?:n[º°o.]*\s*)?(\d{1,4})\s*(?:\/|,\s*|d[oa]s?\s+|de\s+)?\s*(STF|STJ)\b`, "giu");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (taken.overlaps(start, end)) continue;
    const court = match[2].toUpperCase();
    out.push({ kind: "informativo", key: `informativo|${court}|${Number(match[1])}`, label: `Informativo ${Number(match[1])} do ${court}`, fields: { court, number: Number(match[1]) }, raw: match[0], start, end });
    taken.add(start, end);
  }
}

function extractTheses(text: string, taken: Taken, out: ExtractedCitation[]) {
  const pattern = new RegExp(String.raw`\bTese(?:\s+(?:fixada|firmada|jur[íi]dica|de\s+repercuss[ãa]o\s+geral))?\s*[:–—-]\s*`, "giu");
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const bodyStart = start + match[0].length;
    const statement = firstSentence(text.slice(bodyStart));
    if (statement.length < 8) continue;
    const end = bodyStart + (text.slice(bodyStart).indexOf(statement) + statement.length);
    if (taken.overlaps(start, end)) continue;
    const related = [...out].filter((item) => item.end <= start && ["case", "theme", "sumula"].includes(item.kind)).sort((a, b) => b.end - a.end)[0];
    out.push({ kind: "thesis", key: `thesis|${sha256(plain(statement).replace(/[^\p{L}\d ]/gu, "")).slice(0, 12)}`, label: `Tese: ${statement.length > 70 ? `${statement.slice(0, 70)}…` : statement}`, fields: { relatedTo: related?.key ?? null }, raw: text.slice(start, end), start, end, statement });
    taken.add(start, end);
  }
}

// ----- Autores -----
const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+(?:d[aeo]s?\s+|e\s+)?\p{Lu}[\p{L}'’-]+){1,4}`;
const LEADS = /^(?:Segundo|Para|Conforme|De\s+acordo\s+com|Na\s+li[çc][ãa]o\s+de|Nas\s+palavras\s+de|Ensina|Leciona|Sustenta|Afirma|Ver|Cf\.?|Vide)\s+/u;
const HONORIFIC = /^(?:Prof(?:essor|essora|a)?\.?|Dra?\.?|Min(?:istr[oa])?\.?|Des(?:embargador[a]?)?\.?)\s+/u;
const INSTITUTION = new Set(["Supremo", "Superior", "Tribunal", "Conselho", "Constituição", "Defensoria", "Ministério", "Poder", "Administração", "Fazenda", "União", "Estado", "Estados", "Município", "Municípios", "Distrito", "Código", "Lei", "Justiça", "Câmara", "Senado", "Congresso", "Presidente", "República", "Governo", "Corte", "Procuradoria", "Advocacia", "Receita", "Banco", "Universidade", "Ordem", "Segunda", "Primeira", "Terceira", "Quarta", "Quinta", "Sexta", "Turma", "Seção", "Plenário", "Direito", "Tese", "Súmula", "Tema", "Informativo", "Rel", "Decreto", "Emenda", "Medida", "Resolução"]);

function cleanName(raw: string): string | null {
  let name = raw.trim();
  for (let i = 0; i < 3; i += 1) name = name.replace(LEADS, "").replace(HONORIFIC, "");
  const tokens = name.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 6 || tokens.some((token) => INSTITUTION.has(token))) return null;
  return name;
}

export const authorKey = (name: string) => `author|${plain(name).replace(/\b(?:d[aeo]s?|e)\b/g, " ").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim()}`;

function addAuthor(out: ExtractedCitation[], taken: Taken, name: string, raw: string, start: number, end: number, detail?: Record<string, string>, fields: Record<string, string | null> = {}) {
  if (taken.overlaps(start, end)) return;
  out.push({ kind: "author", key: authorKey(name), label: name, fields: { name, ...fields }, raw, start, end, detail });
  taken.add(start, end);
}

function extractAuthors(text: string, taken: Taken, out: ExtractedCitation[]) {
  const biblio = new RegExp(String.raw`(${NAME}),\s+(\p{Lu}[^,.;:()]{3,100}?),\s*p(?:p|ágs?)?\.\s*(\d+(?:\s*[-–]\s*\d+)?)`, "gu");
  for (const match of text.matchAll(biblio)) {
    const name = cleanName(match[1]);
    if (!name) continue;
    const start = (match.index ?? 0) + match[1].indexOf(name);
    addAuthor(out, taken, name, text.slice(start, (match.index ?? 0) + match[0].length), start, (match.index ?? 0) + match[0].length, { work: match[2].trim(), position: `p. ${match[3].replace(/\s+/g, "")}` });
  }
  const abnt = /\((\p{Lu}{2,}(?:\s+\p{Lu}{2,})?),\s*(\d{4})(?:,\s*p\.?\s*(\d+(?:\s*[-–]\s*\d+)?))?\)/gu;
  for (const match of text.matchAll(abnt)) {
    const start = match.index ?? 0;
    const surname = match[1].split(/\s+/).map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(" ");
    addAuthor(out, taken, surname, match[0], start, start + match[0].length, { year: match[2], ...(match[3] ? { position: `p. ${match[3].replace(/\s+/g, "")}` } : {}) }, { year: match[2] });
  }
  const doctrine = new RegExp(String.raw`(?:[Dd]outrina|[Ll]i[çc][ãa]o|[Ee]ntendimento|[Pp]osi[çc][ãa]o)\s+d[eoa]s?\s+(${NAME})`, "gu");
  for (const match of text.matchAll(doctrine)) {
    const name = cleanName(match[1]);
    if (!name) continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
    addAuthor(out, taken, name, match[1], start, start + match[1].length);
  }
  const lead = new RegExp(String.raw`(?:[Ss]egundo|[Pp]ara|[Cc]onforme|[Dd]e\s+acordo\s+com|[Nn]a\s+li[çc][ãa]o\s+de|[Nn]as\s+palavras\s+de|[Ee]nsina|[Ll]eciona|[Ss]ustenta|[Aa]firma)\s+(?:o\s+(?:jurista|doutrinador|autor|professor)\s+|a\s+(?:jurista|autora|professora)\s+)?(${NAME})(?=\s*[,:(]|\s+(?:afirma|ensina|leciona|sustenta|entende|defende|explica|destaca|observa|aponta|diz|escreve|registra)\b)`, "gu");
  for (const match of text.matchAll(lead)) {
    const name = cleanName(match[1]);
    if (!name) continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
    addAuthor(out, taken, name, match[1], start, start + match[1].length);
  }
}

// ----- Metadados de julgados -----
const NAME_TAIL = String.raw`\p{Lu}[\p{L}'’.-]+(?:\s+(?:d[aeo]s?\s+)?\p{Lu}[\p{L}'’.-]+){0,4}`;

export function normalizeDate(value: string): string {
  const [d, m, y] = value.split("/");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${expandYear(y)}`;
}

function enrichCases(text: string, items: ExtractedCitation[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  sorted.forEach((item, index) => {
    if (item.kind !== "case") return;
    const limit = Math.min(text.length, item.end + 260, sorted.slice(index + 1).find((other) => other.kind !== "author" && other.kind !== "thesis")?.start ?? Infinity);
    const window = text.slice(item.end, limit);
    const detail: Record<string, string> = {};
    const relator = new RegExp(String.raw`Rel(?:ator|atora)?\.?\s*(?:Min(?:istr[oa])?\.?|Des(?:embargador[a]?)?\.?|Juiz[a]?)\s*(${NAME_TAIL})`, "u").exec(window);
    if (relator) detail.relator = relator[1].replace(/[.,;]$/, "");
    const judged = /\bj(?:ulgado)?\.?\s*(?:em\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(window);
    if (judged) detail.judgedAt = normalizeDate(judged[1]);
    const published = /\bDJe?\.?\s*(?:de\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(window);
    if (published) detail.publishedAt = normalizeDate(published[1]);
    const body = /(Primeira|Segunda|Terceira|Quarta|Quinta|Sexta)\s+(?:Turma|Se[çc][ãa]o)|Plen[áa]rio|Corte\s+Especial|Tribunal\s+Pleno/iu.exec(window);
    if (body) detail.body = body[0].replace(/\s+/g, " ");
    if (Object.keys(detail).length) item.detail = detail;
  });
}

// Extrai TODAS as citações de um texto, sem sobreposição, em ordem de aparição.
export function extractCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  const taken = new Taken();
  extractArticles(text, taken, out);
  extractSumulas(text, taken, out);
  extractCases(text, taken, out);
  extractThemes(text, taken, out);
  extractInformativos(text, taken, out);
  extractTheses(text, taken, out);
  extractAuthors(text, taken, out);
  extractBareLaws(text, taken, out);
  enrichCases(text, out);
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

export { statementAfter };
