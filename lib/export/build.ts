import { extractCitations } from "@/lib/citations/extract";
import { KIND_ORDER } from "@/lib/citations/types";
import type { CitationKind, CitationRegistry } from "@/lib/citations/types";
import type { DraftBlock, ThemeDraft, ThemeDraftResult } from "@/lib/drafting/types";
import type { MapNode, ThematicMap } from "@/lib/thematic/types";
import type { ExportDocument, ExportPart, ExportSection, GlossaryEntry, IndexGroup, RenderBlock } from "@/lib/export/types";

export type ExportInput = { title: string; subtitle?: string; parts: { map: ThematicMap; drafts: ThemeDraftResult[]; registry: CitationRegistry }[] };

const GROUP_TITLES: Record<CitationKind, string> = { law: "Legislação", sumula: "Súmulas", case: "Julgados", theme: "Temas de repercussão geral e repetitivos", informativo: "Informativos", thesis: "Teses", author: "Doutrina" };
const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function blocksOf(draft: ThemeDraft): RenderBlock[] {
  return draft.blocks.flatMap((block: DraftBlock): RenderBlock[] => [
    { kind: "subheading", text: block.heading },
    ...block.paragraphs.map((text): RenderBlock => ({ kind: "paragraph", text })),
    ...(block.table ? [{ kind: "table", headers: block.table.headers, rows: block.table.rows } as RenderBlock] : []),
  ]);
}

const textOfBlocks = (blocks: RenderBlock[]) => blocks.flatMap((block) => (block.kind === "table" ? [...block.headers, ...block.rows.flat()] : [block.text])).join("\n");

// Monta a representação intermediária a partir do mapa temático, das redações verificadas e do registro de citações.
export function buildExportDocument(input: ExportInput): ExportDocument {
  const warnings: string[] = [];
  const parts: ExportPart[] = [];
  const found = new Map<string, { kind: CitationKind; label: string; refs: string[] }>();
  const glossary = new Map<string, GlossaryEntry>();
  let chapter = 0;

  input.parts.forEach((partInput, partIndex) => {
    const { map, drafts, registry } = partInput;
    const known = new Map(registry.citations.map((citation) => [citation.key, citation] as const));
    const draftOf = new Map(drafts.filter((d) => d.draft).map((d) => [d.themeId, d.draft as ThemeDraft] as const));
    const nodes = map.nodes.filter((node) => !node.ignored).sort((a, b) => a.order - b.order);
    const part: ExportPart = { id: `p${partIndex + 1}`, title: map.discipline, sections: [] };

    const addSection = (section: ExportSection, draft: ThemeDraft | undefined) => {
      part.sections.push(section);
      const text = textOfBlocks(section.blocks);
      for (const citation of extractCitations(text)) {
        const confirmed = known.get(citation.key);
        if (!confirmed) continue; // só entra no índice o que o registro confirma
        const entry = found.get(citation.key) ?? { kind: confirmed.kind, label: confirmed.label, refs: [] };
        if (!entry.refs.includes(section.number)) entry.refs.push(section.number);
        found.set(citation.key, entry);
      }
      for (const term of draft?.glossary ?? []) {
        const key = plain(term.term);
        const existing = glossary.get(key);
        if (!existing) glossary.set(key, { term: term.term, definition: term.definition, ref: section.number });
        else if (plain(existing.definition) !== plain(term.definition)) warnings.push(`Glossário: "${term.term}" tem definições diferentes em temas distintos; mantida a primeira (seção ${existing.ref}).`);
      }
    };

    const chapters = nodes.filter((node) => node.level === 1);
    for (const node of chapters) {
      const children = nodes.filter((child) => child.parentId === node.id);
      const own = draftOf.get(node.id);
      const childDrafts = children.filter((child) => draftOf.has(child.id));
      if (!own && childDrafts.length === 0) { warnings.push(`Tema "${node.title}" não tem texto redigido e ficou fora da exportação.`); continue; }
      chapter += 1;
      addSection({ id: `s-${chapter}`, number: String(chapter), title: node.title, level: 1, blocks: own ? blocksOf(own) : [] }, own);
      let sub = 0;
      for (const child of children as MapNode[]) {
        const draft = draftOf.get(child.id);
        if (!draft) { warnings.push(`Subtema "${child.title}" não tem texto redigido e ficou fora da exportação.`); continue; }
        sub += 1;
        addSection({ id: `s-${chapter}-${sub}`, number: `${chapter}.${sub}`, title: child.title, level: 2, blocks: blocksOf(draft) }, draft);
      }
    }
    parts.push(part);
  });

  const collator = new Intl.Collator("pt-BR", { numeric: true });
  const index: IndexGroup[] = KIND_ORDER.map((kind) => ({
    kind,
    title: GROUP_TITLES[kind],
    entries: [...found.entries()].filter(([, entry]) => entry.kind === kind).map(([key, entry]) => ({ key, label: entry.label, refs: entry.refs })).sort((a, b) => collator.compare(a.label, b.label)),
  })).filter((group) => group.entries.length > 0);
  const glossaryList = [...glossary.values()].sort((a, b) => collator.compare(a.term, b.term));
  const sections = parts.flatMap((part) => part.sections);
  return {
    title: input.title,
    subtitle: input.subtitle ?? parts.map((part) => part.title).join(" · "),
    parts,
    index,
    glossary: glossaryList,
    warnings,
    stats: { chapters: sections.filter((s) => s.level === 1).length, sections: sections.filter((s) => s.level === 2).length, indexEntries: index.reduce((total, group) => total + group.entries.length, 0), glossaryTerms: glossaryList.length },
  };
}
