const PAGE_MARKER = /^\s*\[\s*p(?:á|a)gina\s+\d+\s*\]\s*$/i;

function normalizeLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function cleanDocumentText(text: string, pageTexts: string[] = []) {
  const pages = pageTexts.length ? pageTexts : [text];
  const pageLines = pages.map((page) => page.split(/\r?\n/).map(normalizeLine).filter(Boolean));
  const occurrences = new Map<string, number>();

  pageLines.forEach((lines) => {
    new Set(lines.filter((line) => line.length >= 3 && line.length <= 140)).forEach((line) => {
      occurrences.set(line.toLocaleLowerCase(), (occurrences.get(line.toLocaleLowerCase()) ?? 0) + 1);
    });
  });

  const cleanedPages = pageLines.map((lines) => lines
    .filter((line) => !PAGE_MARKER.test(line))
    .filter((line) => !/^(p(?:á|a)gina|page)\s*\d+$/i.test(line))
    .filter((line) => (occurrences.get(line.toLocaleLowerCase()) ?? 0) < 2 || line.length > 140)
    .join("\n")
    .replace(/([a-záàâãéêíóôõúç])-\s*\n\s*([a-záàâãéêíóôõúç])/gi, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim());

  return cleanedPages.filter(Boolean).join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
}
