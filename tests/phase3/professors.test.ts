import { describe, expect, it } from "vitest";
import { cleanDocument } from "@/lib/cleaning/clean";
import { findNoise, noiseCategories } from "@/lib/cleaning/noise-verifier";
import { maskReferences } from "@/lib/cleaning/references";
import type { DocumentExtraction, LayoutBlock } from "@/lib/extraction/types";

const block = (kind: LayoutBlock["kind"], text: string): LayoutBlock => ({ kind, text, fontSize: 10, y: 0, column: null, heading: false, source: "text-layer" });
function doc(...pages: LayoutBlock[][]): DocumentExtraction {
  return { format: "pdf", status: "text", pageCount: pages.length, warnings: [], pages: pages.map((blocks, index) => ({ page: index + 1, width: 595, height: 842, blocks, charCount: 100, hasTextLayer: true, hasImages: false, blank: false, needsOcr: false, ocr: "not-needed" as const })) };
}
const one = (text: string, options?: Parameters<typeof cleanDocument>[1]) => cleanDocument(doc([block("body", text)]), options);

describe("padrão: o texto final não referencia professores", () => {
  it.each([
    ["Segundo o Prof. Fulano de Tal, o ato administrativo é vinculado.", "O ato administrativo é vinculado."],
    ["Conforme a Professora Maria Souza, a competência é concorrente.", "A competência é concorrente."],
    ["Para a Profa. Maria Souza, a competência é concorrente.", "A competência é concorrente."],
    ["O Prof. Fulano de Tal explica que o ato é vinculado quando a lei não deixa margem.", "O ato é vinculado quando a lei não deixa margem."],
    ["A aula do Professor João da Silva tratou do tema. O conceito é amplo.", "A aula tratou do tema. O conceito é amplo."],
    ["Nas palavras do Prof. Celso Antônio Bandeira de Mello, a discricionariedade tem limites.", "A discricionariedade tem limites."],
  ])("%s", (input, expected) => {
    const result = one(input);
    expect(result.text).toBe(expected);
    expect(result.removed).toEqual([{ category: "professor", count: expect.any(Number) }]);
    expect(noiseCategories(result.text)).toEqual([]);
  });
  it("não confunde 'Profissional' nem cita autor doutrinário sem honorífico", () => {
    for (const text of ["O Profissional liberal responde por seus atos.", "A doutrina de Celso Antônio Bandeira de Mello aponta que o ato é vinculado.", "Segundo Autor Exemplo, Manual Fictício de Processo, p. 123, a tese é clara."]) {
      const result = one(text);
      expect(result.text).toBe(text);
      expect(result.removed).toEqual([]);
    }
  });
  it("cabeçalho/rodapé com professor é descartado inteiro, mesmo sem repetição", () => {
    const result = cleanDocument(doc([block("header", "Aula 3 - Prof. Fulano de Tal"), block("body", "Conteúdo da aula sobre a defensoria pública."), block("footer", "Prof. Fulano de Tal")]));
    expect(result.text).toBe("Conteúdo da aula sobre a defensoria pública.");
  });
  it("a limpeza só remove: nenhuma palavra nova (além da inicial maiúscula)", () => {
    const input = "Segundo o Prof. Fulano de Tal, o ato administrativo é vinculado e a lei prevê o prazo.";
    const inputWords = new Set(input.toLowerCase().match(/[\p{L}\d]+/gu));
    expect((one(input).text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []).filter((word) => !inputWords.has(word))).toEqual([]);
  });
});

describe("opção: manter menções a professores", () => {
  const text = "Segundo o Prof. Fulano de Tal, o ato administrativo é vinculado.";
  it('professors: "keep" mantém o texto idêntico', () => {
    const result = one(text, { professors: "keep" });
    expect(result.text).toBe(text);
    expect(result.removed).toEqual([]);
  });
  it("o verificador respeita a mesma política", () => {
    expect(noiseCategories(text)).toEqual(["professor"]);
    expect(noiseCategories(text, { professors: "keep" })).toEqual([]);
  });
  it("cabeçalho com professor também é mantido quando a opção está ligada", () => {
    const result = cleanDocument(doc([block("header", "Resumo do Prof. Fulano de Tal"), block("body", "Conteúdo.")]), { professors: "keep" });
    expect(result.text).toContain("Resumo do Prof. Fulano de Tal");
  });
});

describe("opção: referências específicas protegidas", () => {
  it("mantém só a referência escolhida e remove as demais", () => {
    const result = one("Conforme o Prof. Celso Antônio Bandeira de Mello, o ato é vinculado. Segundo o Prof. Fulano de Tal, o prazo é de dez dias.", { keepReferences: ["Celso Antônio Bandeira de Mello"] });
    expect(result.text).toBe("Conforme o Prof. Celso Antônio Bandeira de Mello, o ato é vinculado. O prazo é de dez dias.");
  });
  it("ignora maiúsculas/minúsculas e espaços extras ao proteger", () => {
    const result = one("Para o Prof. CELSO  antônio bandeira de mello, o ato é vinculado.", { keepReferences: ["Celso Antônio Bandeira de Mello"] });
    expect(result.text).toBe("Para o Prof. CELSO antônio bandeira de mello, o ato é vinculado.");
  });
  it("protege também um trecho com link que a usuária quer referenciar", () => {
    const keep = "https://www.planalto.gov.br/ccivil_03/constituicao";
    const text = `O texto integral está em ${keep} para consulta. Siga @perfil e baixe o material.`;
    const result = one(text, { keepReferences: [keep] });
    expect(result.text).toBe(`O texto integral está em ${keep} para consulta.`);
    expect(findNoise(result.text, { keepReferences: [keep] })).toEqual([]);
    expect(findNoise(result.text).map((f) => f.category)).toContain("url");
  });
  it("a proteção vale para termos conhecidos: o termo protegido não é removido", () => {
    const result = one("A Escola Alfa publicou o parecer. A Escola Beta também.", { knownTerms: ["Escola Alfa", "Escola Beta"], keepReferences: ["Escola Alfa"] });
    expect(result.text).toBe("A Escola Alfa publicou o parecer. A também.");
  });
  it("maskReferences restaura exatamente o que protegeu", () => {
    const masked = maskReferences("Veja Celso Antônio e CELSO ANTÔNIO ainda.", ["celso antônio"]);
    expect(masked.text).not.toContain("Celso");
    expect(masked.restore(masked.text)).toBe("Veja Celso Antônio e CELSO ANTÔNIO ainda.");
  });
});
