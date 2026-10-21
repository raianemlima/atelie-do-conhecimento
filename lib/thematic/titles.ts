const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na", "nos", "nas", "para", "por", "com", "ao", "aos", "um", "uma", "sobre", "pelo", "pela", "ou", "que"]);

function stem(token: string): string {
  let out = token;
  if (out.length > 4 && out.endsWith("oes")) out = `${out.slice(0, -3)}ao`;
  else if (out.length > 4 && out.endsWith("aes")) out = `${out.slice(0, -3)}ao`;
  else if (out.length > 4 && out.endsWith("ais")) out = `${out.slice(0, -3)}al`;
  else if (out.length > 4 && out.endsWith("eis")) out = `${out.slice(0, -3)}el`;
  else if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) out = out.slice(0, -1);
  return out;
}

// Títulos genéricos se repetem em temas diferentes ("Conceito", "Introdução"); agrupar por eles exige revisão.
const GENERIC_WORDS = ["introdução", "conceito", "noções", "considerações", "apresentação", "resumo", "conclusão", "anotações", "geral", "disposições", "observações"];

export function titleTokens(title: string): string[] {
  const plain = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [...new Set(plain.split(" ").filter((token) => token && !STOPWORDS.has(token)).map(stem))];
}

export const normalizeTitle = (title: string) => titleTokens(title).sort().join(" ");


// 0 a 1. Média de Jaccard e contenção: "Risco administrativo" ⊂ "Teoria do risco administrativo" pontua alto,
// mas "Responsabilidade civil" x "Responsabilidade penal" não.
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (!left.size || !right.size) return 0;
  const inter = [...left].filter((token) => right.has(token)).length;
  if (!inter) return 0;
  if (inter === left.size && inter === right.size) return 1;
  const union = left.size + right.size - inter;
  return 0.5 * (inter / union) + 0.5 * (inter / Math.min(left.size, right.size));
}

const GENERIC_TOKENS = new Set(GENERIC_WORDS.flatMap((word) => titleTokens(word)));

export function isGenericTitle(title: string): boolean {
  const tokens = titleTokens(title);
  return tokens.length > 0 && tokens.every((token) => GENERIC_TOKENS.has(token));
}
