// Menções ao professor do curso. Política padrão: REMOVER (o material final não referencia professores).
// A usuária pode manter tudo (professors: "keep") ou proteger referências específicas (keepReferences).
const HONORIFIC = String.raw`Prof(?:essor|essora|a)?\.?`;
const NAME = String.raw`[A-ZÁ-Ú][\wÀ-ú'’-]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁ-Ú][\wÀ-ú'’-]+){0,4}`;
const VERBS = "explica|ensina|afirma|diz|destaca|lembra|comenta|sustenta|defende|entende|esclarece|ressalta|observa|menciona";

// Ordem importa: do mais específico (sujeito + verbo) ao mais genérico (honorífico + nome).
export const PROFESSOR_RULES: RegExp[] = [
  new RegExp(String.raw`\b[OoAa]\s+${HONORIFIC}\s+${NAME}\s+(?:${VERBS})(?:\s+que)?`, "g"),
  new RegExp(String.raw`(?:\b(?:[Ss]egundo|[Cc]onforme|[Dd]e acordo com|[Pp]ara|[Nn]as palavras d[oa]|[Mm]inistrad[oa] por|[Dd][oa]|[Pp]el[oa]|[Cc]om)\s+(?:[oa]\s+)?)?\b${HONORIFIC}\s+${NAME}(?:\s*,)?`, "g"),
];

export const PROFESSOR_DETECT = new RegExp(String.raw`\b${HONORIFIC}\s+[A-ZÁ-Ú][\wÀ-ú]+`);
