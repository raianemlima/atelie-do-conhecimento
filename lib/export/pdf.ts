import { PDFDict, PDFDocument, PDFFont, PDFHexString, PDFName, PDFNumber, StandardFonts, rgb } from "pdf-lib";
import type { ExportDocument, RenderBlock } from "@/lib/export/types";

const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 64, right: 64, top: 72, bottom: 78 };
const WIDTH = PAGE.w - M.left - M.right;
const BODY = { size: 11, lead: 16 };
const INK: Rgb = [0.14, 0.13, 0.12], ACCENT: Rgb = [0.72, 0.27, 0.18], MUTED: Rgb = [0.44, 0.41, 0.37], SHADE: Rgb = [0.91, 0.89, 0.84], LINE: Rgb = [0.74, 0.71, 0.64];

type Rgb = [number, number, number];
type FontKey = "body" | "bold" | "italic" | "sans" | "sansBold" | "sansItalic";
type Cmd =
  | { t: "text"; x: number; y: number; text: string; font: FontKey; size: number; color: Rgb }
  | { t: "rule"; x1: number; x2: number; y: number; color: Rgb; w: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; color: Rgb };
type Anchor = { page: number; y: number };
type TocItem = { id: string; title: string; level: number };

const FALLBACKS: Record<string, string> = { "\u00a0": " ", "\u2009": " ", "\u200b": "", "\u2010": "-", "\u2011": "-", "\u2212": "-", "\u2192": "->", "\u2190": "<-", "\u2265": ">=", "\u2264": "<=", "\u2260": "!=", "\u2026": "..." };

export type PdfResult = { bytes: Uint8Array; pages: number; warnings: string[] };

export async function renderPdf(doc: ExportDocument, generatedAt: Date = new Date(0)): Promise<PdfResult> {
  const pdf = await PDFDocument.create();
  const fonts: Record<FontKey, PDFFont> = {
    body: await pdf.embedFont(StandardFonts.TimesRoman), bold: await pdf.embedFont(StandardFonts.TimesRomanBold), italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    sans: await pdf.embedFont(StandardFonts.Helvetica), sansBold: await pdf.embedFont(StandardFonts.HelveticaBold), sansItalic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const warnings = [...doc.warnings];
  const supported = new Set(fonts.body.getCharacterSet());
  let replaced = 0;
  // As fontes padrão do PDF cobrem o português; o que ficar fora é trocado e contado (nunca em silêncio).
  const clean = (text: string) => [...text.replace(/[\r\n\t]+/g, " ")].map((ch) => {
    if (supported.has(ch.codePointAt(0) as number)) return ch;
    replaced += 1;
    return FALLBACKS[ch] ?? "?";
  }).join("");
  const width = (text: string, font: FontKey, size: number) => fonts[font].widthOfTextAtSize(text, size);

  function wrap(text: string, font: FontKey, size: number, max: number, firstIndent = 0): string[] {
    const lines: string[] = [];
    let line = "", limit = max - firstIndent;
    for (const word of clean(text).split(/ +/).filter(Boolean)) {
      let piece = word;
      while (width(piece, font, size) > limit && piece.length > 1) { // palavra maior que a linha: quebra dura
        let cut = piece.length - 1;
        while (cut > 1 && width(piece.slice(0, cut), font, size) > limit) cut -= 1;
        if (line) { lines.push(line); line = ""; limit = max; }
        lines.push(piece.slice(0, cut)); limit = max; piece = piece.slice(cut);
      }
      const next = line ? `${line} ${piece}` : piece;
      if (line && width(next, font, size) > limit) { lines.push(line); line = piece; limit = max; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // ----------------------------------------------------------------------------------------------------- paginação
  const pages: Cmd[][] = [];
  const anchors = new Map<string, Anchor>();
  let cur: Cmd[] = [];
  let y = 0;
  const top = PAGE.h - M.top, bottom = M.bottom;
  const newPage = () => { cur = []; pages.push(cur); y = top; };
  const room = () => y - bottom;
  const ensure = (needed: number) => { if (room() < needed) newPage(); };
  const text = (x: number, yy: number, t: string, font: FontKey, size: number, color: Rgb = INK) => cur.push({ t: "text", x, y: yy, text: t, font, size, color });

  function paragraph(t: string, opts: { font?: FontKey; size?: number; lead?: number; indent?: number; first?: number; after?: number; color?: Rgb } = {}) {
    const font = opts.font ?? "body", size = opts.size ?? BODY.size, lead = opts.lead ?? BODY.lead, indent = opts.indent ?? 0;
    const lines = wrap(t, font, size, WIDTH - indent, opts.first ?? 0);
    let i = 0;
    while (i < lines.length) {
      const remaining = lines.length - i;
      const fit = Math.floor(room() / lead);
      // órfã/viúva: nunca deixa uma única linha sozinha no fim ou no começo da página
      if (fit < Math.min(2, remaining) || (remaining > fit && remaining - fit < 2 && fit < 3)) { newPage(); continue; }
      const take = remaining > fit ? (remaining - fit < 2 ? fit - 1 : fit) : remaining;
      for (let k = 0; k < take; k += 1) { y -= lead; const first = i + k === 0; text(M.left + indent + (first ? opts.first ?? 0 : 0), y + lead * 0.28, lines[i + k], font, size, opts.color ?? INK); }
      i += take;
      if (i < lines.length) newPage();
    }
    y -= opts.after ?? 7;
  }

  function heading(title: string, level: "part" | "chapter" | "section" | "sub", id?: string) {
    const spec = { part: { size: 30, font: "sansBold" as FontKey, before: 0, after: 24 }, chapter: { size: 22, font: "sansBold" as FontKey, before: 0, after: 18 }, section: { size: 15, font: "sansBold" as FontKey, before: 18, after: 8 }, sub: { size: 12, font: "sansItalic" as FontKey, before: 12, after: 5 } }[level];
    const lines = wrap(title, spec.font, spec.size, WIDTH);
    const height = lines.length * spec.size * 1.25 + spec.before + spec.after;
    if (level === "chapter" || level === "part") newPage(); else ensure(height + BODY.lead * 3); // título nunca fica sozinho no fim da página
    if (level === "part") y -= 160;
    if (y < top) y -= spec.before;
    if (id) anchors.set(id, { page: pages.length - 1, y: y });
    for (const line of lines) { y -= spec.size * 1.25; text(M.left, y + spec.size * 0.25, line, spec.font, spec.size, level === "sub" ? MUTED : level === "section" ? INK : ACCENT); }
    if (level === "chapter" || level === "part") { y -= 8; cur.push({ t: "rule", x1: M.left, x2: M.left + WIDTH, y, color: LINE, w: 0.8 }); }
    y -= spec.after;
  }

  function table(block: Extract<RenderBlock, { kind: "table" }>) {
    const columns = Math.max(1, block.headers.length, ...block.rows.map((r) => r.length));
    const colW = WIDTH / columns, pad = 5, size = 9.5, lead = 12.5;
    const cellLines = (row: string[], font: FontKey) => Array.from({ length: columns }, (_, i) => wrap(row[i] ?? "", font, size, colW - pad * 2));
    const drawRow = (lines: string[][], from: number, count: number, font: FontKey, shade: boolean) => {
      const h = count * lead + pad * 2;
      if (shade) cur.push({ t: "rect", x: M.left, y: y - h, w: WIDTH, h, color: SHADE });
      lines.forEach((cell, c) => cell.slice(from, from + count).forEach((line, k) => text(M.left + c * colW + pad, y - pad - (k + 1) * lead + lead * 0.28, line, font, size)));
      cur.push({ t: "rule", x1: M.left, x2: M.left + WIDTH, y: y - h, color: LINE, w: 0.5 });
      y -= h;
    };
    const header = cellLines(block.headers, "sansBold");
    const headerH = Math.max(...header.map((c) => c.length)) * lead + pad * 2;
    const startTable = () => { cur.push({ t: "rule", x1: M.left, x2: M.left + WIDTH, y, color: LINE, w: 0.5 }); drawRow(header, 0, Math.max(...header.map((c) => c.length)), "sansBold", true); };
    ensure(headerH + lead * 3 + pad * 2);
    startTable();
    for (const row of block.rows) {
      const lines = cellLines(row, "sans");
      const total = Math.max(1, ...lines.map((c) => c.length));
      if (total * lead + pad * 2 > room() && total * lead + pad * 2 <= top - bottom - headerH) { newPage(); startTable(); }
      let done = 0;
      while (done < total) {
        const fit = Math.floor((room() - pad * 2) / lead);
        if (fit < 1) { newPage(); startTable(); continue; }
        const take = Math.min(fit, total - done);
        drawRow(lines, done, take, "sans", false);
        done += take;
        if (done < total) { newPage(); startTable(); }
      }
    }
    y -= 12;
  }

  const items: TocItem[] = [];
  const multiple = doc.parts.length > 1;
  const body = () => {
    doc.parts.forEach((part) => {
      if (multiple) { items.push({ id: part.id, title: part.title, level: 0 }); heading(part.title, "part", part.id); }
      for (const section of part.sections) {
        items.push({ id: section.id, title: `${section.number}. ${section.title}`, level: (multiple ? 1 : 0) + (section.level - 1) });
        heading(`${section.number}. ${section.title}`, section.level === 1 ? "chapter" : "section", section.id);
        for (const block of section.blocks) {
          if (block.kind === "subheading") heading(block.text, "sub");
          else if (block.kind === "paragraph") paragraph(block.text);
          else table(block);
        }
      }
    });
    if (doc.index.length) {
      items.push({ id: "indice-remissivo", title: "Índice remissivo", level: 0 });
      heading("Índice remissivo", "chapter", "indice-remissivo");
      for (const group of doc.index) {
        ensure(BODY.lead * 4);
        y -= 8; y -= 15; text(M.left, y + 4, clean(group.title), "sansBold", 12); y -= 6;
        for (const entry of group.entries) paragraph(`${entry.label} — ${entry.refs.join(", ")}`, { size: 10, lead: 13.5, indent: 14, first: -14, after: 2 });
      }
    }
    if (doc.glossary.length) {
      items.push({ id: "glossario", title: "Glossário", level: 0 });
      heading("Glossário", "chapter", "glossario");
      for (const entry of doc.glossary) {
        ensure(14.5 * 4); // termo e começo da definição ficam juntos
        paragraph(entry.term, { font: "sansBold", size: 10.5, lead: 15, after: 1 });
        paragraph(`${entry.definition} (${entry.ref})`, { size: 10.5, lead: 14.5, indent: 14, after: 8 });
      }
    }
  };
  body();
  const bodyPages = pages.slice();

  // ----------------------------------------------------------------------------------------------------- sumário
  const STEP = 19;
  const firstCap = Math.floor((top - bottom - 60) / STEP), otherCap = Math.floor((top - bottom) / STEP);
  const tocPages = items.length <= firstCap ? 1 : 1 + Math.ceil((items.length - firstCap) / otherCap);
  const offset = 1 + tocPages; // capa + páginas do sumário; a numeração impressa é a posição absoluta
  const pageNumberOf = (id: string) => (anchors.get(id)?.page ?? 0) + offset + 1;

  const cover: Cmd[] = [];
  cover.push({ t: "rect", x: 0, y: PAGE.h - 230, w: PAGE.w, h: 8, color: ACCENT });
  cover.push({ t: "text", x: M.left, y: PAGE.h - 270, text: "ATELIÊ DO CONHECIMENTO", font: "sansBold", size: 10, color: ACCENT });
  let cy = PAGE.h - 325;
  for (const line of wrap(doc.title, "sansBold", 32, WIDTH)) { cover.push({ t: "text", x: M.left, y: cy, text: line, font: "sansBold", size: 32, color: INK }); cy -= 40; }
  cy -= 14;
  for (const line of wrap(doc.subtitle, "sans", 14, WIDTH)) { cover.push({ t: "text", x: M.left, y: cy, text: line, font: "sans", size: 14, color: MUTED }); cy -= 20; }

  const tocCmds: Cmd[][] = [];
  const tocLinks: { page: number; y: number; id: string }[] = [];
  for (let p = 0; p < tocPages; p += 1) {
    const cmds: Cmd[] = [];
    tocCmds.push(cmds);
    let ty = top;
    if (p === 0) { ty -= 26; cmds.push({ t: "text", x: M.left, y: ty, text: "Sumário", font: "sansBold", size: 22, color: ACCENT }); ty -= 12; cmds.push({ t: "rule", x1: M.left, x2: M.left + WIDTH, y: ty, color: LINE, w: 0.8 }); ty -= 22; }
    const start = p === 0 ? 0 : firstCap + (p - 1) * otherCap;
    const cap = p === 0 ? firstCap : otherCap;
    for (const item of items.slice(start, start + cap)) {
      const indent = item.level * 16, font: FontKey = item.level === 0 ? "sansBold" : "sans", size = item.level === 0 ? 10.5 : 10;
      const num = String(pageNumberOf(item.id));
      const label = wrap(item.title, font, size, WIDTH - indent - 40)[0] ?? "";
      const labelW = width(label, font, size), numW = width(num, font, size);
      const dots = ".".repeat(Math.max(0, Math.floor((WIDTH - indent - labelW - numW - 12) / width(".", "sans", size))));
      cmds.push({ t: "text", x: M.left + indent, y: ty, text: label, font, size, color: INK });
      if (dots) cmds.push({ t: "text", x: M.left + indent + labelW + 4, y: ty, text: dots, font: "sans", size, color: LINE });
      cmds.push({ t: "text", x: M.left + WIDTH - numW, y: ty, text: num, font, size, color: INK });
      tocLinks.push({ page: 1 + p, y: ty, id: item.id });
      ty -= STEP;
    }
  }

  // ----------------------------------------------------------------------------------------------------- escrita
  const all: Cmd[][] = [cover, ...tocCmds, ...bodyPages];
  const pdfPages = all.map((cmds, index) => {
    const page = pdf.addPage([PAGE.w, PAGE.h]);
    for (const c of cmds) {
      if (c.t === "text") page.drawText(c.text, { x: c.x, y: c.y, font: fonts[c.font], size: c.size, color: rgb(...c.color) });
      else if (c.t === "rule") page.drawLine({ start: { x: c.x1, y: c.y }, end: { x: c.x2, y: c.y }, thickness: c.w, color: rgb(...c.color) });
      else page.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, color: rgb(...c.color) });
    }
    if (index > 0) {
      const label = String(index + 1);
      page.drawText(label, { x: PAGE.w / 2 - width(label, "sans", 9) / 2, y: 40, font: fonts.sans, size: 9, color: rgb(...MUTED) });
    }
    return page;
  });

  const ctx = pdf.context;
  const dest = (id: string) => {
    const anchor = anchors.get(id);
    const page = pdfPages[(anchor?.page ?? 0) + offset];
    return ctx.obj([page.ref, PDFName.of("XYZ"), PDFNumber.of(0), PDFNumber.of(Math.min(PAGE.h, (anchor?.y ?? top) + 30)), PDFNumber.of(0)]);
  };
  for (const link of tocLinks) {
    const annot = ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [M.left, link.y - 4, M.left + WIDTH, link.y + 12], Border: [0, 0, 0], Dest: dest(link.id) });
    pdfPages[link.page].node.addAnnot(ctx.register(annot));
  }
  // marcadores (painel de navegação do leitor de PDF)
  if (items.length) {
    const outlines = ctx.nextRef();
    const refs = items.map(() => ctx.nextRef());
    const parentOf = items.map((item, i) => { for (let j = i - 1; j >= 0; j -= 1) if (items[j].level < item.level) return j; return -1; });
    const children = (parent: number) => items.map((_, i) => i).filter((i) => parentOf[i] === parent);
    const descendants = (i: number): number => children(i).reduce((total, c) => total + 1 + descendants(c), 0);
    items.forEach((item, i) => {
      const siblings = children(parentOf[i]);
      const pos = siblings.indexOf(i);
      const kids = children(i);
      const dict = new Map<PDFName, unknown>();
      dict.set(PDFName.of("Title"), PDFHexString.fromText(clean(item.title)));
      dict.set(PDFName.of("Parent"), parentOf[i] === -1 ? outlines : refs[parentOf[i]]);
      if (pos > 0) dict.set(PDFName.of("Prev"), refs[siblings[pos - 1]]);
      if (pos < siblings.length - 1) dict.set(PDFName.of("Next"), refs[siblings[pos + 1]]);
      if (kids.length) { dict.set(PDFName.of("First"), refs[kids[0]]); dict.set(PDFName.of("Last"), refs[kids[kids.length - 1]]); dict.set(PDFName.of("Count"), PDFNumber.of(descendants(i))); }
      dict.set(PDFName.of("Dest"), dest(item.id));
      ctx.assign(refs[i], PDFDict.fromMapWithContext(dict as Map<PDFName, never>, ctx));
    });
    const roots = children(-1);
    ctx.assign(outlines, PDFDict.fromMapWithContext(new Map<PDFName, never>([[PDFName.of("Type"), PDFName.of("Outlines") as never], [PDFName.of("First"), refs[roots[0]] as never], [PDFName.of("Last"), refs[roots[roots.length - 1]] as never], [PDFName.of("Count"), PDFNumber.of(items.length) as never]]), ctx));
    pdf.catalog.set(PDFName.of("Outlines"), outlines);
    pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  }
  pdf.setTitle(clean(doc.title)); pdf.setAuthor("Ateliê do Conhecimento"); pdf.setProducer("Ateliê do Conhecimento"); pdf.setCreator("Ateliê do Conhecimento");
  pdf.setCreationDate(generatedAt); pdf.setModificationDate(generatedAt); pdf.setLanguage?.("pt-BR");
  if (replaced > 0) warnings.push(`${replaced} caractere(s) fora do alfabeto do PDF foram substituídos.`);
  return { bytes: await pdf.save(), pages: all.length, warnings };
}
