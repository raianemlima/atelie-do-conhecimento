import { draftableNodes } from "@/lib/drafting/inputs";
import { extractCitations } from "@/lib/citations/extract";
import type { CitationRegistry } from "@/lib/citations/types";
import type { ThemeDraft, ThemeDraftResult } from "@/lib/drafting/types";
import type { SegmentationResult } from "@/lib/segmentation/types";
import { splitSentences, endsAbruptly } from "@/lib/study-guide/sentences";
import type { ThematicMap } from "@/lib/thematic/types";
import type { Finding, ReviewReport } from "@/lib/verification/types";

export const MIN_SCORE = 85;
const WEIGHTS = { limpeza: 25, fidelidade: 35, cobertura: 25, integridade: 15 } as const;

const NOISE: { pattern: RegExp; label: string }[] = [
  { pattern: /\b[\w-]+\.(?:pdf|docx?|txt|md)\b/i, label: "nome de arquivo" },
  { pattern: /\bp[aá]g(?:ina|\.)\s*\d+/i, label: "número de página" },
  { pattern: /https?:\/\/|www\.\S+/i, label: "URL" },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, label: "e-mail" },
  { pattern: /(?:^|\s)@\w{3,}/, label: "perfil de rede social" },
  { pattern: /\[Trecho \d+\]|CITA[ÇC][ÕO]ES PERMITIDAS|TRECHOS:|\bsegmento\s+[0-9a-f]{6,}/i, label: "marca interna do pipeline" },
  { pattern: /\b(?:como (?:uma )?(?:ia|intelig[eê]ncia artificial|modelo de linguagem)|aqui est[aá]|espero ter ajudado|a seguir,? apresento)\b|\bclaro!/i, label: "fala da IA" },
  { pattern: /\b(?:apostila|curso|professor(?:a)?|prof\.)\s+(?:de\s+)?\p{Lu}/u, label: "menção à origem (apostila, curso ou professor)" },
];

const textBlocks = (draft: ThemeDraft) => draft.blocks.flatMap((block) => [block.heading, ...block.paragraphs, ...(block.table ? [...block.table.headers, ...block.table.rows.flat()] : [])]);
const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

// Remove do texto as frases que citam algo que o registro não confirma e devolve o que foi removido.
export function removeUnconfirmed(draft: ThemeDraft, registry: CitationRegistry): { draft: ThemeDraft; removed: { label: string; sentence: string }[] } {
  const known = new Set(registry.citations.map((citation) => citation.key));
  const removed: { label: string; sentence: string }[] = [];
  const blocks = draft.blocks.map((block) => ({
    ...block,
    paragraphs: block.paragraphs.map((paragraph) => splitSentences(paragraph).filter((sentence) => {
      const bad = extractCitations(sentence).find((found) => !known.has(found.key));
      if (bad) removed.push({ label: bad.label, sentence });
      return !bad;
    }).join(" ")).filter(Boolean),
  })).filter((block) => block.paragraphs.length > 0 || block.table);
  return { draft: { ...draft, blocks, citationsUsed: draft.citationsUsed.filter((key) => known.has(key)) }, removed };
}

export type VerifyInput = {
  drafts: ThemeDraftResult[];
  map: ThematicMap;
  registry: CitationRegistry;
  segmentations: SegmentationResult[];
  forbiddenTerms?: string[];
  minScore?: number;
};

export function verifyDrafts(input: VerifyInput): { report: ReviewReport; drafts: ThemeDraftResult[] } {
  const findings: Finding[] = [];
  const removedCitations: ReviewReport["removedCitations"] = [];
  const forbidden = [...input.map.documents.map((d) => d.title), ...(input.forbiddenTerms ?? [])].filter((term) => term.trim().length >= 3);
  const cleaned: ThemeDraftResult[] = [];
  const seen = new Map<string, string>();

  // Fidelidade: remove citações não confirmadas (antes das demais checagens, que olham o texto já corrigido).
  for (const result of input.drafts) {
    if (!result.draft) { cleaned.push(result); continue; }
    const { draft, removed } = removeUnconfirmed(result.draft, input.registry);
    removed.forEach((item) => { removedCitations.push({ themeId: result.themeId, ...item }); findings.push({ dimension: "fidelidade", severity: "aviso", themeId: result.themeId, message: `Citação não confirmada removida: ${item.label}.` }); });
    cleaned.push({ ...result, draft });
  }

  let noiseCount = 0, integrityIssues = 0;
  for (const result of cleaned) {
    if (!result.draft) { findings.push({ dimension: "integridade", severity: "bloqueante", themeId: result.themeId, message: `Tema "${result.title}" sem texto gerado.` }); integrityIssues += 1; continue; }
    const blocks = textBlocks(result.draft);
    const body = plain(blocks.join("\n"));
    for (const { pattern, label } of NOISE) if (blocks.some((block) => pattern.test(block))) { noiseCount += 1; findings.push({ dimension: "limpeza", severity: "bloqueante", themeId: result.themeId, message: `Ruído na saída: ${label}.` }); }
    for (const term of forbidden) if (body.includes(plain(term))) { noiseCount += 1; findings.push({ dimension: "limpeza", severity: "bloqueante", themeId: result.themeId, message: "Menção ao título de uma fonte." }); }
    for (const block of result.draft.blocks) {
      const last = block.paragraphs[block.paragraphs.length - 1];
      if (last && endsAbruptly(last)) { integrityIssues += 1; findings.push({ dimension: "integridade", severity: "bloqueante", themeId: result.themeId, message: `Bloco "${block.heading}" parece truncado.` }); }
      for (const paragraph of block.paragraphs) {
        const key = plain(paragraph);
        if (key.length < 40) continue;
        const first = seen.get(key);
        if (first) { integrityIssues += 1; findings.push({ dimension: "integridade", severity: "aviso", themeId: result.themeId, message: first === result.themeId ? "Parágrafo duplicado no mesmo tema." : "Parágrafo repetido em outro tema." }); }
        else seen.set(key, result.themeId);
      }
    }
  }

  // Cobertura: todo tema ativo do mapa foi redigido e todo trecho com conteúdo está ligado a um tema redigido.
  const drafted = new Set(cleaned.filter((result) => result.draft).map((result) => result.themeId));
  const leaves = draftableNodes(input.map);
  const missing = leaves.filter((node) => !drafted.has(node.id));
  missing.forEach((node) => findings.push({ dimension: "cobertura", severity: "bloqueante", themeId: node.id, message: `Tema "${node.title}" não aparece na apostila.` }));
  const linked = new Set(leaves.filter((node) => drafted.has(node.id)).flatMap((node) => node.coverage.map((item) => item.segmentId)));
  const ignoredSegments = new Set(input.map.nodes.filter((node) => node.ignored).flatMap((node) => node.coverage.map((item) => item.segmentId)));
  const relevant = input.segmentations.flatMap((s) => s.segments).filter((segment) => segment.chars > 0 && !segment.container && !ignoredSegments.has(segment.id));
  const unlinkedSegments = relevant.filter((segment) => !linked.has(segment.id)).map((segment) => segment.id);
  if (unlinkedSegments.length) findings.push({ dimension: "cobertura", severity: "aviso", themeId: null, message: `${unlinkedSegments.length} trecho(s) das fontes não estão ligados a nenhum tema redigido.` });

  const ratio = (bad: number, total: number) => Math.max(0, 1 - bad / Math.max(1, total));
  const total = Math.max(1, cleaned.length);
  const dimensions = {
    limpeza: Math.round(WEIGHTS.limpeza * ratio(noiseCount, total)),
    fidelidade: Math.round(WEIGHTS.fidelidade * ratio(removedCitations.length, Math.max(total, removedCitations.length + input.registry.stats.total))),
    cobertura: Math.round(WEIGHTS.cobertura * Math.min(ratio(missing.length, Math.max(1, leaves.length)), ratio(unlinkedSegments.length, Math.max(1, relevant.length)))),
    integridade: Math.round(WEIGHTS.integridade * ratio(integrityIssues, total)),
  };
  const score = dimensions.limpeza + dimensions.fidelidade + dimensions.cobertura + dimensions.integridade;
  const minScore = input.minScore ?? MIN_SCORE;
  const blocking = findings.some((finding) => finding.severity === "bloqueante");
  const report: ReviewReport = {
    schema: 1,
    score,
    minScore,
    passed: score >= minScore && !blocking,
    dimensions,
    findings,
    removedCitations,
    divergences: input.registry.citations.filter((citation) => citation.divergences.length).map((citation) => ({ label: citation.label, fields: citation.divergences.map((d) => d.field) })),
    singleSourceThemes: input.map.nodes.filter((node) => !node.ignored && node.singleSource).map((node) => node.title),
    unlinkedSegments,
    illegible: input.segmentations.flatMap((s) => s.warnings),
  };
  return { report, drafts: cleaned };
}
