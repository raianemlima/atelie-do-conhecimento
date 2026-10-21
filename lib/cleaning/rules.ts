// Definições ÚNICAS de ruído, usadas pelo limpador (para remover) e pelo verificador (para auditar).
export type NoiseCategory =
  | "watermark" | "file_name" | "page_reference" | "url" | "email" | "social_handle" | "qr_code" | "advertisement"
  | "source_reference" | "pipeline_mark" | "professor" | "ai_talk" | "page_number" | "hyphen_break" | "known_term";

export type NoiseRule = { category: NoiseCategory; pattern: RegExp; scope: "inline" | "sentence" | "line" };

const URL = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com\.br|org\.br|gov\.br|edu\.br|com|org|net|io|app|me|ly)\b(?:\/[^\s<>"')\]]*)?/gi;

export const NOISE_RULES: NoiseRule[] = [
  // Marcas d'água e licenciamento: removidas só no trecho, o restante do texto permanece.
  { category: "watermark", scope: "inline", pattern: /Licensed to [^\n]*?(?:-\s*[\d.\-/]{6,}\s*)?(?:[ÚU]ltima atualiza[cç][aã]o:\s*\d{2}\/\d{2}\/\d{4})?(?=\s|$)(?:\s*-\s*[\d.\-/]{6,})?/gi },
  { category: "watermark", scope: "inline", pattern: /[ÚU]ltima atualiza[cç][aã]o:\s*\d{2}\/\d{2}\/\d{4}/gi },
  { category: "watermark", scope: "inline", pattern: /D[uú]vidas e sugest[oõ]es:\s*\S+/gi },
  { category: "watermark", scope: "sentence", pattern: /(?:c[oó]pia\s+(?:licenciada|exclusiva)\s+para|uso\s+exclusivo\s+d[eoa]|proibida\s+a\s+(?:reprodu[cç][aã]o|distribui[cç][aã]o)|todos\s+os\s+direitos\s+reservados|©)/i },
  // Referências ao material de origem e a pessoas do curso.
  { category: "source_reference", scope: "inline", pattern: /,?\s*\b(?:conforme|de acordo com|segundo|como visto|vide|veja)\s+(?:(?:o|a|os|as|na|no|em)\s+)?(?:material\s+(?:de\s+apoio|did[aá]tico|complementar|do\s+curso|da\s+aula|do\s+m[oó]dulo|do\s+professor|da\s+apostila)|apostila|(?:a\s+)?aula\s*\d*|(?:o\s+)?v[ií]deo|slides?|(?:este|esse|nosso)\s+(?:material|curso))\b[^.;:\n]*/gi },
  { category: "file_name", scope: "inline", pattern: /\b[\w()+%-]+(?:\.[\w()+%-]+)*\.(?:pdf|docx?|pptx?|xlsx?|txt|md)\b/gi },
  { category: "page_reference", scope: "inline", pattern: /\[\s*p[áa]gina\s*\d+\s*\]|\bp[áa]gina\s+\d+\s+de\s+\d+\b|\bp[áa]g\.\s*\d+\s*(?:\/|de)\s*\d+/gi },
  { category: "pipeline_mark", scope: "inline", pattern: /\[?\b(?:chunk|trecho|fragmento)\s*#?\s*\d+\b\]?|<<?\s*(?:chunk|trecho)[^>]*>>?/gi },
  // Sentenças inteiras que carregam link, contato ou propaganda: o conteúdo restante da frase não é conhecimento.
  { category: "url", scope: "sentence", pattern: URL },
  { category: "email", scope: "sentence", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { category: "social_handle", scope: "sentence", pattern: /(?:^|[\s(])@[\w.]{3,}/g },
  { category: "qr_code", scope: "sentence", pattern: /\bqr\s*-?\s*code\b|escaneie|aponte a c[aâ]mera/gi },
  { category: "advertisement", scope: "sentence", pattern: /\bmatricule-se\b|\bmatr[ií]culas?\s+abertas\b|\binscreva-se\b|\bvagas\s+limitadas\b|\bpacote\s+completo\b|\bcupom\s+(?:de\s+)?desconto\b|\b\d{1,3}\s?%\s*(?:de\s+)?desconto\b|\bcom\s+desconto\b|\bpromo[cç][aã]o\s+(?:especial|imperd[ií]vel|exclusiva|rel[aâ]mpago|de\s+lan[cç]amento)\b|\bsiga\s+(?:o|a|no|na|nosso|nossa)?\s*@\w+|\bsiga[- ]nos\b|\bbaixe\s+(?:o|a|nosso)\s+(?:material|e-?book|app)\b|\bclique\s+aqui\b|\bacesse\s+(?:agora|nosso|o\s+site|www)|\bgaranta\s+(?:j[aá]|sua)\b/gi },
  // Linhas inteiras.
  { category: "page_number", scope: "line", pattern: /^\s*(?:[-–—]\s*)?\d{1,4}\s*(?:[-–—])?\s*$|^\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/ },
  { category: "ai_talk", scope: "line", pattern: /^\s*(?:claro|certo|com certeza|perfeito|ok)[,!.]\s|\b(?:aqui est[aá] (?:o|a|um|uma)\b|como (?:um )?(?:modelo de linguagem|assistente de ia)|espero que (?:isso )?(?:ajude|esteja)|se precisar de mais|posso ajudar (?:com|em))/i },
];

export function freshPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

// Sinais que PODEM ser ruído de curso e dependem de decisão: nunca são removidos por regra, vão para a lista de ambíguos.
export const REVIEW_RULES: { reason: "course_structure_marker"; pattern: RegExp }[] = [
  { reason: "course_structure_marker", pattern: /^(?:aula|m[oó]dulo|ponto|unidade|cap[ií]tulo|parte)\s+\d+\b/i },
];
