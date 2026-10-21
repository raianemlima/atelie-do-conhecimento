// Diplomas legais e suas equivalências: "CDC", "Lei nº 8.078/90" e "Lei 8078/1990" são o mesmo diploma.
export type Diploma = { id: string; label: string };

const CODES: { id: string; label: string; pattern: RegExp }[] = [
  { id: "CF/1988", label: "CF/1988", pattern: /^(?:Constitui[çc][ãa]o\s+(?:Federal|da\s+Rep[úu]blica)(?:\s+(?:Federativa\s+do\s+Brasil\s+)?de\s+1988)?|CRFB(?:\s*\/\s*(?:19)?88)?|CF(?:\s*\/\s*(?:19)?88)?)(?![\p{L}\d])/iu },
  { id: "Lei 13.105/2015", label: "CPC/2015", pattern: /^(?:C[óo]digo\s+de\s+Processo\s+Civil(?:\s+de\s+2015)?|CPC(?:\s*\/\s*(?:20)?15)?)(?![\p{L}\d\/])/iu },
  { id: "Lei 5.869/1973", label: "CPC/1973", pattern: /^(?:C[óo]digo\s+de\s+Processo\s+Civil\s+de\s+1973|CPC\s*\/\s*(?:19)?73)(?![\p{L}\d])/iu },
  { id: "Lei 10.406/2002", label: "CC/2002", pattern: /^(?:C[óo]digo\s+Civil(?:\s+de\s+2002)?|CC\s*\/\s*(?:20)?02)(?![\p{L}\d])/iu },
  { id: "Decreto-Lei 2.848/1940", label: "CP", pattern: /^(?:C[óo]digo\s+Penal|CP)(?![\p{L}\d\/])/iu },
  { id: "Decreto-Lei 3.689/1941", label: "CPP", pattern: /^(?:C[óo]digo\s+de\s+Processo\s+Penal|CPP)(?![\p{L}\d])/iu },
  { id: "Lei 8.078/1990", label: "CDC", pattern: /^(?:C[óo]digo\s+de\s+Defesa\s+do\s+Consumidor|CDC)(?![\p{L}\d])/iu },
  { id: "Lei 8.069/1990", label: "ECA", pattern: /^(?:Estatuto\s+da\s+Crian[çc]a\s+e\s+do\s+Adolescente|ECA)(?![\p{L}\d])/iu },
  { id: "Decreto-Lei 5.452/1943", label: "CLT", pattern: /^(?:Consolida[çc][ãa]o\s+das\s+Leis\s+do\s+Trabalho|CLT)(?![\p{L}\d])/iu },
  { id: "Lei 5.172/1966", label: "CTN", pattern: /^(?:C[óo]digo\s+Tribut[áa]rio\s+Nacional|CTN)(?![\p{L}\d])/iu },
  { id: "Decreto-Lei 4.657/1942", label: "LINDB", pattern: /^(?:Lei\s+de\s+Introdu[çc][ãa]o\s+[àa]s\s+Normas\s+do\s+Direito\s+Brasileiro|LINDB)(?![\p{L}\d])/iu },
  { id: "Lei Complementar 80/1994", label: "LC 80/1994", pattern: /^(?:Lei\s+Org[âa]nica\s+(?:Nacional\s+)?da\s+Defensoria\s+P[úu]blica)(?![\p{L}\d])/iu },
];

const NUMBERED_KIND: Record<string, string> = { lei: "Lei", "lei complementar": "Lei Complementar", lc: "Lei Complementar", "decreto-lei": "Decreto-Lei", decreto: "Decreto", "medida provisória": "Medida Provisória", mp: "Medida Provisória", "emenda constitucional": "Emenda Constitucional", ec: "Emenda Constitucional", "resolução": "Resolução" };

// "Lei nº 8.078/90", "Lei 8078/1990", "LC 80/94", "Decreto-Lei 2.848/40", "EC 45/2004".
export const NUMBERED_DIPLOMA = /^(Lei\s+Complementar|Lei|LC|Decreto-Lei|Decreto|Medida\s+Provis[óo]ria|MP|Emenda\s+Constitucional|EC|Resolu[çc][ãa]o)\s*(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d+)\s*[\/,-]\s*(\d{2}|\d{4})(?![\d])/iu;

export function expandYear(year: string): string {
  if (year.length === 4) return year;
  return Number(year) >= 30 ? `19${year}` : `20${year}`;
}

const formatNumber = (digits: string) => Number(digits.replace(/\./g, "")).toLocaleString("pt-BR");

function numberedId(kind: string, number: string, year: string): Diploma {
  const normalizedKind = NUMBERED_KIND[kind.toLowerCase().replace(/\s+/g, " ").replace("provisoria", "provisória").replace("resolucao", "resolução")] ?? kind;
  const id = `${normalizedKind} ${formatNumber(number)}/${expandYear(year)}`;
  return { id, label: CODES.find((code) => code.id === id)?.label ?? id };
}

// Reconhece um diploma no INÍCIO do texto; devolve também quantos caracteres consumiu.
export function matchDiploma(text: string): { diploma: Diploma; length: number } | null {
  for (const code of CODES) {
    const match = code.pattern.exec(text);
    if (match) return { diploma: { id: code.id, label: code.label }, length: match[0].length };
  }
  const numbered = NUMBERED_DIPLOMA.exec(text);
  if (numbered) return { diploma: numberedId(numbered[1], numbered[2], numbered[3]), length: numbered[0].length };
  return null;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(roman: string): number | null {
  const value = roman.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(value)) return null;
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const current = ROMAN[value[i]];
    const next = ROMAN[value[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && intToRoman(total) === value ? total : null;
}

export function intToRoman(value: number): string {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let rest = value;
  let out = "";
  for (const [amount, symbol] of table) while (rest >= amount) { out += symbol; rest -= amount; }
  return out;
}
