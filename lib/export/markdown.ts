import type { ExportDocument, RenderBlock } from "@/lib/export/types";

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
function table(block: Extract<RenderBlock, { kind: "table" }>): string {
  const width = Math.max(block.headers.length, ...block.rows.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => cell(row[i] ?? ""));
  return [`| ${pad(block.headers).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...block.rows.map((row) => `| ${pad(row).join(" | ")} |`)].join("\n");
}

export function renderMarkdown(doc: ExportDocument): string {
  const out: string[] = [`# ${doc.title}`, "", doc.subtitle ? `_${doc.subtitle}_` : "", "", "## Sumário", ""];
  for (const part of doc.parts) {
    out.push(`- **${part.title}**`);
    for (const s of part.sections) out.push(`${s.level === 2 ? "    " : "  "}- [${s.number}. ${s.title}](#${s.id})`);
  }
  if (doc.index.length) out.push("- [Índice remissivo](#indice-remissivo)");
  if (doc.glossary.length) out.push("- [Glossário](#glossario)");
  out.push("");
  for (const part of doc.parts) {
    out.push(`## ${part.title}`, "");
    for (const s of part.sections) {
      out.push(`<a id="${s.id}"></a>`, "", `${s.level === 1 ? "###" : "####"} ${s.number}. ${s.title}`, "");
      for (const block of s.blocks) {
        if (block.kind === "subheading") out.push(`##### ${block.text}`, "");
        else if (block.kind === "paragraph") out.push(block.text, "");
        else out.push(table(block), "");
      }
    }
  }
  if (doc.index.length) {
    out.push(`<a id="indice-remissivo"></a>`, "", "## Índice remissivo", "");
    for (const group of doc.index) { out.push(`### ${group.title}`, ""); for (const entry of group.entries) out.push(`- ${entry.label} — ${entry.refs.join(", ")}`); out.push(""); }
  }
  if (doc.glossary.length) {
    out.push(`<a id="glossario"></a>`, "", "## Glossário", "");
    for (const entry of doc.glossary) out.push(`**${entry.term}** — ${entry.definition} (${entry.ref})`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
