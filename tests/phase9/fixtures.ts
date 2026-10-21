import { buildCitationRegistry } from "@/lib/citations/registry";
import type { ExportInput } from "@/lib/export/build";
import type { ThemeDraft, ThemeDraftResult } from "@/lib/drafting/types";
import type { Segment, SegmentationResult } from "@/lib/segmentation/types";
import type { MapNode, ThematicMap } from "@/lib/thematic/types";

const LONG = "A Defensoria Pública é instituição permanente e essencial à função jurisdicional do Estado, incumbindo-lhe a orientação jurídica, a promoção dos direitos humanos e a defesa, em todos os graus, judicial e extrajudicial, dos direitos individuais e coletivos dos necessitados, na forma do inciso LXXIV do art. 5º da CF/88. ";
const para = (n: number) => LONG.repeat(n).trim();

const draft = (title: string, extra: Partial<ThemeDraft> = {}): ThemeDraft => ({
  title,
  blocks: [
    { type: "intro", heading: "Introdução", paragraphs: [para(1), "O tema é cobrado com frequência em provas e exige atenção ao texto constitucional e à jurisprudência dos tribunais superiores."] },
    { type: "development", heading: "Desenvolvimento", paragraphs: [para(3), `Conforme a Súmula 421 do STJ, os honorários advocatícios não são devidos à Defensoria Pública quando ela atua contra a pessoa jurídica de direito público à qual pertença. ${para(2)}`] },
    { type: "comparison", heading: "Quadro comparativo", paragraphs: [], table: { headers: ["Tribunal", "Entendimento", "Fundamento"], rows: [["STF", "Legitimidade ampla para a tutela coletiva dos necessitados.", "Art. 134 da CF/88"], ["STJ", "Admite a atuação em favor de grupos hipossuficientes, ainda que não exclusivamente.", "Lei Complementar 80/1994"], ["Doutrina", "Interpretação extensiva em favor da população vulnerável, sem prejuízo da atuação do Ministério Público no mesmo caso concreto e em litisconsórcio.", "REsp 1.234.567/SP"]] } },
    { type: "attention", heading: "Pontos de atenção", paragraphs: ["Atenção ao requisito da pertinência temática: a atuação coletiva da Defensoria depende da vulnerabilidade organizacional do grupo."] },
  ],
  citationsUsed: [],
  ...extra,
});

const result = (themeId: string, title: string, d: ThemeDraft | null): ThemeDraftResult => ({ themeId, title, draft: d, removedCitations: [], error: null, tokensIn: 1, tokensOut: 1, costUsd: 0 });
const node = (id: string, level: 1 | 2, parentId: string | null, title: string, order: number, over: Partial<MapNode> = {}): MapNode => ({ id, level, parentId, title, aliases: [], confidence: 1, needsReview: false, singleSource: false, ignored: null, coverage: [], documentIds: [], chars: 100, order, origin: "auto", ...over });

// Segmentação sintética só para gerar um registro de citações real (as mesmas citações aparecem nas redações).
function registryFor(): ReturnType<typeof buildCitationRegistry> {
  const segment: Segment = { id: "seg1", documentId: "d1", order: 0, level: 1, kind: "section", numbering: null, title: "Fontes", path: [], paragraphs: [{ text: "Art. 5º, LXXIV, da CF/88. Art. 134 da CF/88. Súmula 421 do STJ: os honorários advocatícios não são devidos à Defensoria Pública quando ela atua contra a pessoa jurídica de direito público à qual pertença. REsp 1.234.567/SP. Lei Complementar 80/1994.", pages: [1], kind: "body" }], pages: [1], chars: 300, container: false, windows: [] };
  const seg: SegmentationResult = { documentId: "d1", segments: [segment], ignored: [], warnings: [], stats: { paragraphs: 1, segments: 1, headings: 1, chars: 300 } };
  return buildCitationRegistry({ documents: [{ id: "d1", title: "Fonte" }], segmentations: [seg] });
}

export function makeInput(parts: 1 | 2 = 1): ExportInput {
  const registry = registryFor();
  const nodes = [
    node("c1", 1, null, "Legitimidade da Defensoria Pública", 0),
    node("c1a", 2, "c1", "Tutela coletiva e pertinência temática", 1),
    node("c1b", 2, "c1", "Honorários e prerrogativas", 2),
    node("c2", 1, null, "Assistência jurídica integral e gratuita", 3),
    node("c3", 1, null, "Tema sem redação", 4),
    node("c4", 1, null, "Tema ignorado", 5, { ignored: { reason: "fora do edital", at: "2026-01-01" } }),
  ];
  const map = (discipline: string): ThematicMap => ({ schema: 1, discipline, documents: [{ id: "d1", title: "Fonte" }], nodes, warnings: [], stats: { themes: 4, subthemes: 2, segments: 1, chars: 600, singleSourceThemes: 0, needsReview: 0 } });
  const drafts = (): ThemeDraftResult[] => [
    result("c1", "Legitimidade da Defensoria Pública", draft("Legitimidade", { glossary: [{ term: "Hipossuficiência organizacional", definition: "Vulnerabilidade do grupo que o impede de defender seus direitos por conta própria." }] })),
    result("c1a", "Tutela coletiva e pertinência temática", draft("Tutela coletiva", { glossary: [{ term: "Pertinência temática", definition: "Vínculo entre a finalidade institucional e o objeto da ação coletiva." }] })),
    result("c1b", "Honorários e prerrogativas", draft("Honorários")),
    result("c2", "Assistência jurídica integral e gratuita", draft("Assistência", { glossary: [{ term: "Pertinência temática", definition: "Vínculo entre a finalidade institucional e o objeto da ação coletiva." }] })),
  ];
  const first = { map: map("Direito Constitucional"), drafts: drafts(), registry };
  return { title: "Defensoria Pública — Material de Estudo", parts: parts === 1 ? [first] : [first, { map: map("Direito Processual Civil"), drafts: drafts(), registry }] };
}
