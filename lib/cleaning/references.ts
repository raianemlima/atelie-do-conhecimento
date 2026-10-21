const PRIVATE_OPEN = "";
const PRIVATE_CLOSE = "";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type MaskedText = { text: string; restore(value: string): string };

// Protege referências que a usuária quer manter (nome, trecho, link) contra qualquer regra de remoção:
// troca cada ocorrência por um marcador privado e devolve o original depois da limpeza.
export function maskReferences(text: string, references: string[] = []): MaskedText {
  const kept: string[] = [];
  let out = text;
  const terms = [...new Set(references.map((term) => term.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    out = out.replace(new RegExp(escape(term).replace(/\s+/g, "\\s+"), "gi"), (match) => {
      kept.push(match);
      return `${PRIVATE_OPEN}${kept.length - 1}${PRIVATE_CLOSE}`;
    });
  }
  const restore = (value: string) => value.replace(new RegExp(`${PRIVATE_OPEN}(\\d+)${PRIVATE_CLOSE}`, "g"), (_, index: string) => kept[Number(index)] ?? "");
  return { text: out, restore };
}
