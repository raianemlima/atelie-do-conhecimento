import type { DraftInput } from "@/lib/drafting/types";
import { BLOCK_TYPES } from "@/lib/drafting/types";

// Mude a versão sempre que o texto do prompt mudar (entra na chave de cache da etapa).
export const DRAFT_PROMPT_VERSION = "2";

export const DRAFT_SYSTEM_PROMPT = [
  "Você redige material de estudo para concurso da Defensoria Pública a partir de trechos de fontes fornecidos.",
  "Regras obrigatórias:",
  "1. Use SOMENTE informações presentes nos trechos. Não acrescente fatos, números, leis, súmulas ou julgados que não estejam neles.",
  "2. Cite SOMENTE as citações jurídicas da lista fornecida, copiando o rótulo exatamente; liste as chaves usadas em citationsUsed.",
  "3. Integre as fontes em um texto único e limpo. Nunca mencione nomes de arquivo, apostilas, cursos, professores, páginas ou a existência de fontes.",
  "4. Se as fontes divergirem, apresente as posições sem escolher uma sem base nos trechos.",
  "5. Use blocos didáticos apenas quando os trechos permitirem; omita os que não tiverem base.",
  `6. Responda apenas com um objeto JSON: {"title": string, "blocks": [{"type": ${BLOCK_TYPES.map((t) => `"${t}"`).join("|")}, "heading": string, "paragraphs": string[], "table"?: {"headers": string[], "rows": string[][]}}], "citationsUsed": string[], "glossary"?: [{"term": string, "definition": string}]}.`,
  "7. glossary é opcional: inclua só termos técnicos definidos nos trechos, com a definição neles apoiada; omita se não houver.",
].join("\n");

export function buildDraftPrompt(input: DraftInput): string {
  const sources = input.sources.map((source, index) => `[Trecho ${index + 1}]\n${source.text}`).join("\n\n");
  const citations = input.citations.length
    ? input.citations.map((c) => `- chave: ${c.key} | rótulo: ${c.label}${c.statements.length ? ` | enunciado: ${c.statements.join(" / ")}` : ""}`).join("\n")
    : "(nenhuma citação disponível: não cite normas nem julgados)";
  return `Tema: ${[...input.path, input.title].join(" > ")}\n\nTRECHOS:\n${sources}\n\nCITAÇÕES PERMITIDAS:\n${citations}`;
}
