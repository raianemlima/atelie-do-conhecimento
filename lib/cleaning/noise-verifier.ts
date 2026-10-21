import { PROFESSOR_DETECT } from "@/lib/cleaning/professors";
import { maskReferences } from "@/lib/cleaning/references";
import { NOISE_RULES, freshPattern, type NoiseCategory } from "@/lib/cleaning/rules";

export type NoiseFinding = { category: NoiseCategory; sample: string };

export type VerifyOptions = {
  knownTerms?: string[];
  // Mesma política do limpador: por padrão menções a professores são ruído; "keep" ou referências protegidas não são.
  professors?: "remove" | "keep";
  keepReferences?: string[];
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Verificador de ruído (Contrato de Saída, item 1). Conta qualquer ocorrência, em qualquer posição.
// Cuidado: "p. 123" isolado NÃO é ruído, pois pode ser a posição de uma obra citada (Contrato, item 2).
export function findNoise(rawText: string, options: VerifyOptions = {}): NoiseFinding[] {
  const text = maskReferences(rawText, options.keepReferences).text;
  const findings: NoiseFinding[] = [];
  for (const rule of NOISE_RULES) {
    const pattern = freshPattern(rule.pattern.global ? rule.pattern : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`));
    // page_number é "linha inteira": no verificador, cada linha do texto é testada isoladamente.
    if (rule.scope === "line") {
      for (const line of text.split(/\n/)) { if (new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(line)) findings.push({ category: rule.category, sample: line.trim().slice(0, 60) }); }
      continue;
    }
    for (const match of text.matchAll(pattern)) { if (match[0].trim()) findings.push({ category: rule.category, sample: match[0].trim().slice(0, 60) }); }
  }
  if (options.professors !== "keep") {
    for (const match of text.matchAll(new RegExp(PROFESSOR_DETECT.source, "g"))) findings.push({ category: "professor", sample: match[0].trim().slice(0, 60) });
  }
  for (const match of text.matchAll(/[a-zà-ú]-\s*\n\s*[a-zà-ú]/gi)) findings.push({ category: "hyphen_break", sample: match[0].replace(/\n/g, "⏎") });
  for (const term of options.knownTerms ?? []) {
    if (term.trim() && new RegExp(`\\b${escape(term.trim())}\\b`, "i").test(text)) findings.push({ category: "known_term", sample: term });
  }
  return findings;
}

export function noiseCategories(text: string, options: VerifyOptions = {}): NoiseCategory[] {
  return [...new Set(findNoise(text, options).map((finding) => finding.category))].sort();
}
