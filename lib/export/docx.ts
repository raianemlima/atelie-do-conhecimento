import JSZip from "jszip";
import type { ExportDocument, ExportSection, RenderBlock } from "@/lib/export/types";

const TEXT_WIDTH = 9072; // A4 com margens de 2,5 cm, em twips

const esc = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (style: string, content: string, extra = "") => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${content}</w:p>`;

type Ctx = { bookmark: number };

function heading(ctx: Ctx, level: number, text: string, id: string | null, pageBreak: boolean): string {
  const style = `Heading${Math.min(level, 4)}`;
  const extra = pageBreak ? "<w:pageBreakBefore/>" : "";
  if (!id) return para(style, run(text), extra);
  ctx.bookmark += 1;
  return para(style, `<w:bookmarkStart w:id="${ctx.bookmark}" w:name="${id}"/>${run(text)}<w:bookmarkEnd w:id="${ctx.bookmark}"/>`, extra);
}

function table(block: Extract<RenderBlock, { kind: "table" }>): string {
  const columns = Math.max(1, block.headers.length, ...block.rows.map((row) => row.length));
  const width = Math.floor(TEXT_WIDTH / columns);
  const cellXml = (text: string, header: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E9E2D5"/>' : ""}</w:tcPr>${para("TableText", run(text, header ? "<w:b/>" : ""))}</w:tc>`;
  const row = (cells: string[], header: boolean) => `<w:tr><w:trPr><w:cantSplit/>${header ? "<w:tblHeader/>" : ""}</w:trPr>${Array.from({ length: columns }, (_, i) => cellXml(cells[i] ?? "", header)).join("")}</w:tr>`;
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BDB4A4"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array(columns).fill(`<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${row(block.headers, true)}${block.rows.map((r) => row(r, false)).join("")}</w:tbl>${para("Normal", "", '<w:spacing w:after="120"/>')}`;
}

function blocks(list: RenderBlock[], offset: number, ctx: Ctx): string {
  return list.map((block) => (block.kind === "subheading" ? heading(ctx, 3 + offset, block.text, null, false) : block.kind === "paragraph" ? para("BodyText", run(block.text)) : table(block))).join("");
}

function tocEntry(style: string, text: string, anchor: string, open: boolean, close: boolean): string {
  const begin = open ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' : "";
  const end = close ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : "";
  return para(style, `${begin}<w:hyperlink w:anchor="${anchor}" w:history="1">${run(text)}</w:hyperlink>${end}`);
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria" w:eastAsia="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/><w:lang w:val="pt-BR" w:eastAsia="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="3200" w:after="240" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="24211E"/><w:sz w:val="68"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="6F685F"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="320"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="B8452F"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="24211E"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="24211E"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:i/><w:color w:val="6F685F"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="320"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="B8452F"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="30" w:line="240" w:lineRule="auto"/><w:ind w:left="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="IndexGroup"><w:name w:val="Index Group"/><w:basedOn w:val="Normal"/><w:next w:val="IndexEntry"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="IndexEntry"><w:name w:val="Index Entry"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="260" w:lineRule="auto"/><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="6F685F"/></w:rPr></w:style>
</w:styles>`;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export async function renderDocx(doc: ExportDocument, generatedAt: Date = new Date(0)): Promise<Uint8Array> {
  const ctx: Ctx = { bookmark: 0 };
  const multiple = doc.parts.length > 1;
  const offset = multiple ? 1 : 0; // com várias disciplinas, a disciplina é o nível 1 e os capítulos descem um nível
  const body: string[] = [];
  body.push(para("Title", run(doc.title)), para("Subtitle", run(doc.subtitle)), `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);

  const toc: { style: string; text: string; anchor: string }[] = [];
  doc.parts.forEach((part) => { if (multiple) toc.push({ style: "TOC1", text: part.title, anchor: part.id }); part.sections.forEach((s) => toc.push({ style: s.level === 1 && !multiple ? "TOC1" : "TOC2", text: `${s.number}. ${s.title}`, anchor: s.id })); });
  if (doc.index.length) toc.push({ style: "TOC1", text: "Índice remissivo", anchor: "indice-remissivo" });
  if (doc.glossary.length) toc.push({ style: "TOC1", text: "Glossário", anchor: "glossario" });
  body.push(para("TOCHeading", run("Sumário")));
  toc.forEach((entry, i) => body.push(tocEntry(entry.style, entry.text, entry.anchor, i === 0, i === toc.length - 1)));

  doc.parts.forEach((part) => {
    if (multiple) body.push(heading(ctx, 1, part.title, part.id, true));
    part.sections.forEach((section: ExportSection, i) => {
      const startsPage = section.level === 1 && !(multiple && i === 0);
      body.push(heading(ctx, section.level + offset, `${section.number}. ${section.title}`, section.id, section.level === 1 && (startsPage || !multiple)), blocks(section.blocks, offset, ctx));
    });
  });
  if (doc.index.length) {
    body.push(heading(ctx, 1, "Índice remissivo", "indice-remissivo", true));
    for (const group of doc.index) { body.push(para("IndexGroup", run(group.title))); for (const entry of group.entries) body.push(para("IndexEntry", `${run(entry.label)}${run(` — ${entry.refs.join(", ")}`, '<w:color w:val="6F685F"/>')}`)); }
  }
  if (doc.glossary.length) {
    body.push(heading(ctx, 1, "Glossário", "glossario", true));
    for (const entry of doc.glossary) body.push(para("BodyText", `${run(entry.term, "<w:b/>")}${run(` — ${entry.definition} (${entry.ref})`)}`));
  }

  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="709" w:footer="709" w:gutter="0"/><w:titlePg/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${para("Footer", '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')}</w:ftr>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title)}</dc:title><dc:creator>Ateliê do Conhecimento</dc:creator><dc:language>pt-BR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt.toISOString()}</dcterms:created></cp:coreProperties>`;

  const zip = new JSZip();
  const options = { date: generatedAt };
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`, options);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`, options);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`, options);
  zip.file("word/document.xml", documentXml, options);
  zip.file("word/styles.xml", STYLES, options);
  zip.file("word/footer1.xml", footer, options);
  zip.file("docProps/core.xml", core, options);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
