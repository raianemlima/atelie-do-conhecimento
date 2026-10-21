export type HeadingKind = "structural" | "numbered" | "article" | "styled";
export type HeadingInfo = { kind: HeadingKind; level: number; numbering: string | null; title: string; needsContinuation?: boolean };

const STRUCTURAL = /^(LIVRO|PARTE|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)\s+([IVXLCDM]+|\d+|[ÚU]NICO|GERAL|ESPECIAL)\b[\s\-–—:.]*(.*)$/i;
const STRUCTURAL_LEVEL: Record<string, number> = { LIVRO: 1, PARTE: 1, TITULO: 1, CAPITULO: 2, SECAO: 3, SUBSECAO: 4 };
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(\p{Lu}.{2,150})$/u;
const ARTICLE = /^Art(?:igos?)?\.?\s*(\d+(?:\.\d+)*)\s*[º°o]?(?:-[A-Z])?(?![\p{L}\d])/iu;
const TOC_ENTRY = /\.{4,}\s*\d{1,4}\s*$/;
const TOC_TITLE = /^(sum[áa]rio|[íi]ndice|conte[úu]do)$/i;

const strip = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export const isTocEntry = (text: string) => TOC_ENTRY.test(text);
export const isTocTitle = (text: string) => TOC_TITLE.test(text.trim());

export function classifyHeading(text: string, styled: boolean): HeadingInfo | null {
  const value = text.trim();
  if (!value || isTocEntry(value)) return null;
  // Artigo de lei é um parágrafo inteiro (pode ser longo): reconhecido pelo início, sem limite de tamanho.
  const article = ARTICLE.exec(value);
  if (article) return { kind: "article", level: 9, numbering: `Art. ${article[1]}º`, title: `Art. ${article[1]}º` };
  if (value.length > 200) return null;
  const structural = STRUCTURAL.exec(value);
  if (structural) {
    const rest = structural[3].trim();
    return { kind: "structural", level: STRUCTURAL_LEVEL[strip(structural[1])] ?? 2, numbering: `${structural[1].toUpperCase()} ${structural[2].toUpperCase()}`, title: rest, needsContinuation: rest === "" };
  }
  const numbered = NUMBERED.exec(value);
  if (numbered && value.length <= 140 && !/[;,]$/.test(value)) {
    const remainder = numbered[2].trim();
    const allCaps = remainder === remainder.toUpperCase();
    if (!/\.$/.test(remainder) || styled || allCaps) return { kind: "numbered", level: numbered[1].split(".").length, numbering: numbered[1], title: remainder.replace(/\.$/, "") };
  }
  if (styled && value.length <= 120 && !/[;,]$/.test(value)) return { kind: "styled", level: 0, numbering: null, title: value };
  return null;
}
