import { describe, expect, it } from "vitest";
import { extractCorpus, findResidualNoise } from "../helpers";

// Testes de caracterização: registram o comportamento ATUAL (inclusive defeitos conhecidos).
// Fases seguintes devem alterar estes snapshots de forma deliberada e revisada, nunca por acidente.

const CF_134_TRECHO = "a orientação jurídica, a promoção dos direitos humanos e a defesa, em todos os graus";

describe("extração de PDF — comportamento atual", () => {
  it.each([
    "01-texto-simples.pdf",
    "02a-complementar-conceito.pdf",
    "02b-complementar-legitimidade.pdf",
    "03a-quase-identico.pdf",
    "03b-quase-identico.pdf",
    "04-ruidoso.pdf",
    "05-citacoes.pdf",
  ])("%s: texto, páginas e status", async (name) => {
    expect(await extractCorpus(name)).toMatchSnapshot();
  });

  it("01: preserva o texto de lei sem alteração", async () => {
    const result = await extractCorpus("01-texto-simples.pdf");
    expect(result.status).toBe("text");
    expect(result.pageCount).toBe(2);
    expect(result.extractedText.replace(/\s+/g, " ")).toContain(CF_134_TRECHO);
  });

  it("05: preserva lei, súmula, julgado e autor", async () => {
    const { extractedText } = await extractCorpus("05-citacoes.pdf");
    const flat = extractedText.replace(/\s+/g, " ");
    expect(flat).toContain("Art. 5º, LXXIV");
    expect(flat).toContain("Súmula 421 do STJ");
    expect(flat).toContain("REsp 0000000/XX");
    expect(flat).toContain("Autor Exemplo, Manual Fictício de Processo, p. 123");
  });

  it("03a/03b: quase idênticos geram textos distintos (sem fusão no nível da extração)", async () => {
    const [a, b] = await Promise.all([extractCorpus("03a-quase-identico.pdf"), extractCorpus("03b-quase-identico.pdf")]);
    expect(a.extractedText).not.toBe(b.extractedText);
    expect(b.extractedText.startsWith(a.extractedText)).toBe(true);
  });

  it("04: DEFEITO CONHECIDO — ruído residual no texto consolidado e nas páginas", async () => {
    const result = await extractCorpus("04-ruidoso.pdf");
    // Fase 3 deve zerar ambas as listas. Hoje o ruído sobrevive, principalmente em pageTexts,
    // que é a fonte usada pela apostila integrada.
    expect({
      extractedText: findResidualNoise(result.extractedText),
      pageTexts: findResidualNoise(result.pageTexts.join("\n\n")),
    }).toMatchSnapshot();
  });

  it("04: marca d'água de licenciamento já é removida (correção do PR #5)", async () => {
    const result = await extractCorpus("04-ruidoso.pdf");
    expect(result.pageTexts.join("\n")).not.toMatch(/licensed to|aluno@example|000\.000\.000-00/i);
  });

  it("06: PDF digitalizado sem camada de texto resulta em no-text (sem OCR)", async () => {
    const result = await extractCorpus("06-digitalizado.pdf");
    expect(result.status).toBe("no-text");
    expect(result.extractedText).toBe("");
  });

  it("07: PDF corrompido rejeita a extração", async () => {
    await expect(extractCorpus("07-corrompido.pdf")).rejects.toMatchSnapshot();
  });

  it("08: PDF protegido por senha rejeita a extração", async () => {
    await expect(extractCorpus("08-protegido.pdf")).rejects.toMatchSnapshot();
  });
});
