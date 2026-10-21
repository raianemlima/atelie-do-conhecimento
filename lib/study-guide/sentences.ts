// Divisão em frases que respeita abreviações jurídicas ("art.", "nº.", "Min.") e numeração ("ADI 3. 510", "1.").
const ABBREVIATIONS = new Set([
  "art", "arts", "inc", "incs", "par", "parag", "al", "cap", "caps", "n", "no", "nº", "n°", "nos", "p", "pp", "fl", "fls", "min", "rel", "des", "dr", "dra", "sr", "sra", "prof", "profa", "adv",
  "ex", "cf", "v", "vs", "obs", "ed", "vol", "ss", "s", "sec", "tít", "tit", "ob", "op", "cit", "apud", "j", "dj", "dje", "rs", "sp", "lc", "dl", "mp", "ec", "res", "dec", "ac", "pág", "pag", "e.g", "i.e", "etc", "inf", "info",
]);

const lastToken = (text: string) => (text.match(/([\p{L}\d°º§.]+)$/u)?.[1] ?? "").replace(/\.$/, "");

function isBoundary(before: string, after: string): boolean {
  const next = after.trimStart();
  if (!next) return true;
  const first = next[0];
  // Frase nova começa com maiúscula ou aspas; minúscula ou dígito indicam continuação ("ADI 3. 510", "art. 5. º").
  if (!/[\p{Lu}"“‘(]/u.test(first)) return false;
  const token = lastToken(before);
  const bare = token.toLowerCase();
  if (ABBREVIATIONS.has(bare)) return false;
  if (/^\p{Lu}$/u.test(token)) return false; // inicial de nome
  if (/^\d{1,3}$/.test(token) && before.trim() === token) return false; // marcador de lista no início ("1.")
  return true;
}

export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences: string[] = [];
  let start = 0;
  const pattern = /[.!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean))) {
    const end = match.index + match[0].length;
    if (isBoundary(clean.slice(start, match.index), clean.slice(end))) {
      sentences.push(clean.slice(start, end).trim());
      start = end;
    }
  }
  const rest = clean.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

export const endsAbruptly = (text: string): boolean => {
  const trimmed = text.trim();
  if (!/[.!?:;"”)]$/.test(trimmed)) return true;
  return /[.]$/.test(trimmed) && (ABBREVIATIONS.has(lastToken(trimmed).toLowerCase()) || /^\p{Lu}$/u.test(lastToken(trimmed)));
};
