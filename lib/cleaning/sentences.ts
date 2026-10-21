const ABBREVIATIONS = new Set(["art", "arts", "inc", "al", "p", "pp", "n", "nº", "no", "ed", "v", "vol", "cf", "rel", "min", "des", "dr", "dra", "prof", "sr", "sra", "ex", "etc", "ibid", "op", "cit", "fls", "fl", "c", "s", "ss", "esp", "obs", "res", "ap", "rec", "resp", "hc", "adi", "adc", "adpf", "re", "rext", "mc", "pl", "lc", "dec", "ml", "tj", "trf", "stf", "stj"]);

// Divide em sentenças sem quebrar em abreviações jurídicas ("Art. 134", "Min. Fulano", "REsp 1.234/SP").
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  const boundary = /([.!?])(["”')\]]*)\s+(?=[A-ZÁ-Ú0-9"“(\[\uE002])/g;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[1].length + match[2].length;
    const before = text.slice(start, match.index ?? 0);
    const lastToken = (before.split(/\s+/).pop() ?? "").replace(/[^\p{L}\d]/gu, "").toLowerCase();
    if (match[1] === "." && (ABBREVIATIONS.has(lastToken) || /^\d{1,3}$/.test(lastToken) || lastToken.length === 1)) continue;
    sentences.push(text.slice(start, end).trim());
    start = end;
    while (text[start] === " ") start += 1;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}
