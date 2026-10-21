import { analyzeText, selectKeyPoints, type GuideSection } from "@/lib/study-guide/analyze";

export type GuideMeta = { title: string; fileName: string; importedAt: string; formatLabel: string; sizeLabel: string; pageCount: number; dateLabel: string };

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Destaca o enquadramento legal (art. 5º, Súmula 421, Lei 8.078/1990…) sem alterar o texto.
const LEGAL = /\b(?:arts?\.\s*\d[\d.]*(?:º|°)?(?:-[A-Z])?|S[úu]mula(?:\s+Vinculante)?\s+\d+|Lei(?:\s+Complementar)?\s+n?[º°o.]*\s*\d[\d.]*\/\d{2,4}|(?:REsp|RE|ADI|ADPF|ADC|HC|MS)\s+\d[\d.]*)/g;
const highlight = (text: string) => escapeHtml(text).replace(LEGAL, (match) => `<mark>${match}</mark>`);

const CSS = `:root{--ink:#24211e;--muted:#6f685f;--paper:#f6f2ea;--card:#fffdf9;--accent:#b8452f;--accent-soft:#f3e1da;--line:#e4dccf}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.75 Georgia,"Times New Roman",serif;-webkit-text-size-adjust:100%}
.layout{max-width:1080px;margin:0 auto;padding:40px 24px 80px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px}
nav.toc{position:sticky;top:24px;align-self:start;font:14px/1.45 system-ui,Arial,sans-serif}
nav.toc h2{margin:0 0 12px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
nav.toc ol{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}
nav.toc li{margin:0}nav.toc a{display:block;padding:7px 0 7px 14px;color:var(--ink);text-decoration:none}
nav.toc a:hover{color:var(--accent);background:var(--accent-soft)}
main{min-width:0}
.cover{padding:40px 44px;border-radius:18px;background:#ebe3d5;border:1px solid var(--line)}
.kicker{color:var(--accent);font:600 11px/1.2 system-ui,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase}
.cover h1{font:700 clamp(30px,5vw,52px)/1.08 Georgia,serif;margin:14px 0 10px;letter-spacing:-.02em}
.cover p{margin:0;color:var(--muted);font:14px/1.5 system-ui,Arial,sans-serif}
h2.block{margin:52px 0 16px;font:700 13px/1 system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);padding-bottom:10px;border-bottom:1px solid var(--line)}
.points{counter-reset:p;list-style:none;margin:0;padding:0;display:grid;gap:12px}
.points li{counter-increment:p;position:relative;padding:16px 18px 16px 58px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.points li::before{content:counter(p);position:absolute;left:16px;top:15px;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;font:600 14px/28px system-ui,Arial,sans-serif;text-align:center}
section.topic{margin:0 0 22px;padding:26px 30px;background:var(--card);border:1px solid var(--line);border-radius:14px;scroll-margin-top:24px}
section.topic header{display:flex;gap:14px;align-items:baseline;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}
section.topic .n{font:700 14px/1 system-ui,Arial,sans-serif;color:var(--accent)}
section.topic h3{margin:0;font:700 22px/1.3 Georgia,serif}
section.topic p{margin:0 0 14px;max-width:68ch;hyphens:auto}section.topic p:last-child{margin-bottom:0}
mark{background:var(--accent-soft);color:inherit;padding:0 .2em;border-radius:3px}
ol.review{margin:0;padding-left:22px;display:grid;gap:8px}
.empty{padding:20px 24px;background:var(--card);border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font:13px/1.6 system-ui,Arial,sans-serif}
@media(max-width:860px){.layout{grid-template-columns:1fr;padding:20px 16px 60px;gap:20px}nav.toc{position:static}.cover{padding:28px 22px}section.topic{padding:20px 18px}}
@media print{body{background:#fff;font-size:12pt}.layout{display:block;padding:0}nav.toc{display:none}section.topic,.points li{break-inside:avoid;border-color:#ccc}.cover{background:#fff}}`;

type Topic = { heading: string; paragraphs: string[]; sources?: string[] };
type Page = { title: string; kicker: string; subtitle: string; topics: Topic[]; keyPoints: string[]; footer: string; excluded: number };

function renderPage(page: Page): string {
  const topics = page.topics.map((topic, index) => ({ ...topic, id: `t${index + 1}`, n: String(index + 1).padStart(2, "0") }));
  const toc = topics.length > 1 ? `<nav class="toc" aria-label="Sumário"><h2>Sumário</h2><ol>${topics.map((t) => `<li><a href="#${t.id}">${escapeHtml(t.heading)}</a></li>`).join("")}</ol></nav>` : `<nav class="toc"></nav>`;
  const points = page.keyPoints.length ? `<ol class="points">${page.keyPoints.map((point) => `<li>${highlight(point)}</li>`).join("")}</ol>` : `<div class="empty">Não há trechos suficientes para destacar pontos essenciais.</div>`;
  // A origem de cada tema fica registrada de forma invisível (atributo de dados), nunca no texto.
  const body = topics.length ? topics.map((t) => `<section class="topic" id="${t.id}"${t.sources?.length ? ` data-sources="${escapeHtml(t.sources.join(" | "))}"` : ""}><header><span class="n">${t.n}</span><h3>${escapeHtml(t.heading)}</h3></header>${t.paragraphs.map((p) => `<p>${highlight(p)}</p>`).join("")}</section>`).join("") : `<div class="empty">Não foi possível gerar o conteúdo porque não há texto extraído.</div>`;
  const headings = topics.flatMap((t) => (t.heading === "Introdução" ? [] : [t.heading])).slice(0, 6);
  const questions = (headings.length ? headings.map((h) => `Explique com suas palavras: ${h}.`) : ["Qual é a tese ou assunto principal do texto?", "Quais conceitos precisam ser definidos com suas próprias palavras?"]).map((q) => `<li>${escapeHtml(q)}</li>`).join("");
  const omitted = page.excluded ? ` · ${page.excluded} trecho(s) de referência, apresentação ou fragmento omitido(s)` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)} — ${escapeHtml(page.kicker)}</title><style>${CSS}</style></head><body><div class="layout">${toc}<main><header class="cover"><span class="kicker">Ateliê · ${escapeHtml(page.kicker)}</span><h1>${escapeHtml(page.title)}</h1><p>${escapeHtml(page.subtitle)}</p></header><h2 class="block">Pontos essenciais</h2>${points}<h2 class="block">Conteúdo</h2>${body}<h2 class="block">Perguntas para revisar</h2><ol class="review">${questions}</ol><footer>${page.footer}${omitted}</footer></main></div></body></html>`;
}

export function buildStudyGuideHtml(meta: GuideMeta, extractedText: string): string {
  const analysis = analyzeText(extractedText);
  return renderPage({
    title: meta.title,
    kicker: "guia de estudo",
    subtitle: `Leitura didática criada a partir de ${meta.fileName} · ${meta.dateLabel}`,
    topics: analysis.sections.map((section) => ({ heading: section.heading ?? "Introdução", paragraphs: section.paragraphs })),
    keyPoints: analysis.keyPoints,
    footer: `Arquivo original: ${escapeHtml(meta.fileName)} · Formato: ${escapeHtml(meta.formatLabel)} · ${escapeHtml(meta.sizeLabel)} · ${meta.pageCount} unidade(s)`,
    excluded: analysis.excluded.length,
  });
}

const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();

// Apostila integrada: junta os documentos por tema (mesmo cabeçalho) e elimina parágrafos repetidos entre eles.
export function buildIntegratedGuideHtml(project: { name: string; dateLabel: string }, documents: { title: string; fileName: string; formatLabel: string; pageCount: number; extractedText: string }[]): string {
  const groups = new Map<string, Topic>();
  const seen = new Set<string>();
  let excluded = 0;
  for (const document of documents) {
    const analysis = analyzeText(document.extractedText);
    excluded += analysis.excluded.length;
    for (const section of analysis.sections) {
      const heading = section.heading ?? "Introdução";
      const key = plain(heading);
      const topic = groups.get(key) ?? { heading, paragraphs: [], sources: [] };
      for (const paragraph of section.paragraphs) {
        const fingerprint = plain(paragraph);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        topic.paragraphs.push(paragraph);
      }
      if (!topic.sources?.includes(document.fileName)) topic.sources?.push(document.fileName);
      groups.set(key, topic);
    }
  }
  const topics = [...groups.values()].filter((topic) => topic.paragraphs.length > 0);
  const sections: GuideSection[] = topics.map((topic) => ({ heading: topic.heading, paragraphs: topic.paragraphs }));
  const catalog = documents.map((document, index) => `${String(index + 1).padStart(2, "0")} ${escapeHtml(document.title)} (${escapeHtml(document.formatLabel)}, ${document.pageCount} unidade(s))`).join(" · ");
  return renderPage({
    title: project.name,
    kicker: "apostila integrada",
    subtitle: `${documents.length} documento(s) reunidos por tema · ${project.dateLabel}`,
    topics,
    keyPoints: selectKeyPoints(sections),
    footer: `Documentos reunidos: ${catalog}`,
    excluded,
  });
}
