import { describe, expect, it } from "vitest";
import { analyzeText } from "@/lib/study-guide/analyze";
import { splitSentences } from "@/lib/study-guide/sentences";

const NOISY = [
  "Direitos Difusos e Coletivos",
  "Referências bibliográficas utilizadas",
  "Esse material foi produzido com base nas obras “Interesses Difusos e Coletivos”, de Adriano Andrade, Cleber Masson e Landolfo Andrade; “Curso de Direito Processual Civil: processo coletivo”, de Fredie Didier Jr.",
  "O que vai estudar neste material",
  "Ponto 2:",
  "Legitimidade ativa",
  "O caput do art.",
  "5º da Lei 7.347/1985 prevê que a Defensoria Pública possui legitimidade para propor a ação civil pública, nos termos da lei.",
  "5.",
  "Art.",
  "Segundo o STJ, a associação deve estar constituída há pelo menos um ano, requisito que pode ser dispensado pelo juiz em caso de manifesto interesse social.",
  "Por exclusão, o conceito de autoridade pública previsto na LC nº.",
  "80/1994 não alcança entes privados, conforme o entendimento majoritário da doutrina e da jurisprudência.",
  "Interesses difusos são transindividuais, de natureza indivisível, cujos titulares são pessoas indeterminadas e ligadas por circunstâncias de fato.",
  "famosa ADI 3.",
  "Corte Especial – Info 629 STJ.",
].join("\n\n");

describe("divisão em frases", () => {
  it("não corta em abreviações, numeração nem 'ADI 3. 510'", () => {
    expect(splitSentences("O art. 5º da CF garante isso. Conforme a ADI 3. 510, é assim. O Min. Fulano votou.")).toEqual(["O art. 5º da CF garante isso.", "Conforme a ADI 3. 510, é assim.", "O Min. Fulano votou."]);
    expect(splitSentences("Aplica-se a LC nº. 80/1994 ao caso. Outra frase.")).toHaveLength(2);
  });
  it("não separa marcador de lista nem inicial de nome", () => {
    expect(splitSentences("1. Conceito de J. Silva é amplo.")).toEqual(["1. Conceito de J. Silva é amplo."]);
  });
});

describe("análise do texto", () => {
  const result = analyzeText(NOISY);
  const all = result.sections.flatMap((s) => s.paragraphs).join(" ");
  it("descarta referências bibliográficas e apresentação do material", () => {
    expect(all).not.toMatch(/Esse material foi produzido|Cleber Masson|O que vai estudar/);
    expect(result.excluded.map((e) => e.reason)).toEqual(expect.arrayContaining(["referencia", "meta"]));
  });
  it("não deixa fragmentos soltos ('5.', 'Art.', 'famosa ADI 3.')", () => {
    for (const text of [...result.keyPoints, ...result.sections.flatMap((s) => s.paragraphs)]) expect(["5.", "Art.", "famosa ADI 3."]).not.toContain(text);
  });
  it("junta frases partidas pela extração (art. / 5º; LC nº. / 80/1994)", () => {
    expect(all).toContain("O caput do art. 5º da Lei 7.347/1985 prevê");
    expect(all).toContain("LC nº. 80/1994 não alcança");
  });
  it("usa cabeçalhos como títulos de seção", () => {
    expect(result.sections.map((s) => s.heading)).toContain("Legitimidade ativa");
  });
  it("pontos essenciais são frases completas e selecionadas, não um por parágrafo", () => {
    expect(result.keyPoints.length).toBeGreaterThan(0);
    expect(result.keyPoints.length).toBeLessThanOrEqual(10);
    for (const point of result.keyPoints) { expect(point).toMatch(/[.!?]$/); expect(point.split(/\s+/).length).toBeGreaterThanOrEqual(8); }
    expect(result.keyPoints.length).toBeLessThan(result.sections.flatMap((section) => section.paragraphs).length);
    for (const point of result.keyPoints) expect(all).toContain(point);
  });
  it("texto vazio não quebra", () => {
    expect(analyzeText("")).toEqual({ sections: [], keyPoints: [], excluded: [] });
  });
});
