import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDocument } from "@/lib/cleaning/clean";
import { findNoise, noiseCategories } from "@/lib/cleaning/noise-verifier";
import { splitSentences } from "@/lib/cleaning/sentences";
import { extractOriginal } from "@/lib/extraction";
import type { DocumentExtraction, ExtractedPage, LayoutBlock } from "@/lib/extraction/types";
import { CORPUS_DIR } from "../helpers";

const pdf = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const clean = async (name: string, knownTerms?: string[]) => cleanDocument(await extractOriginal("pdf", pdf(name)), { knownTerms });

const block = (kind: LayoutBlock["kind"], text: string, heading = false): LayoutBlock => ({ kind, text, fontSize: 10, y: 0, column: null, heading, source: "text-layer" });
function doc(...pages: LayoutBlock[][]): DocumentExtraction {
  const extracted: ExtractedPage[] = pages.map((blocks, index) => ({ page: index + 1, width: 595, height: 842, blocks, charCount: 100, hasTextLayer: true, hasImages: false, blank: false, needsOcr: false, ocr: "not-needed" }));
  return { format: "pdf", status: "text", pageCount: pages.length, pages: extracted, warnings: [] };
}
const words = (text: string) => text.toLowerCase().match(/[\p{L}\d]+/gu) ?? [];

describe("PDF ruidoso do corpus passa no verificador de ruído", () => {
  it("texto final exato: só conteúdo, sem cabeçalho, rodapé, marca d'água, link, propaganda ou página", async () => {
    const result = await clean("04-ruidoso.pdf");
    expect(result.text).toBe([
      "O Estado prestará assistência jurídica integral e gratuita aos que comprovarem insuficiência de recursos. A Defensoria Pública é essencial à função jurisdicional do Estado.",
      "A atuação extrajudicial inclui a promoção da conciliação e da mediação entre as partes.",
      "A autonomia funcional e administrativa decorre do texto constitucional e é garantia institucional.",
    ].join("\n\n"));
    expect(findNoise(result.text, { knownTerms: ["Curso Exemplo", "Fulano de Tal", "cursoexemplo"] })).toEqual([]);
  });
  it("relata o que removeu por categoria, sem remover o que não deve", async () => {
    const result = await clean("04-ruidoso.pdf");
    expect(Object.fromEntries(result.removed.map((r) => [r.category, r.count]))).toEqual({ running_footer: 3, running_header: 6, social_handle: 1, source_reference: 1, url: 2 });
    expect(result.learnedTerms).toContain("CURSO EXEMPLO PREPARATÓRIO");
    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.stats.outputChars).toBeLessThan(result.stats.inputChars);
  });
  it("o texto bruto, antes da limpeza, REPROVA no verificador (a régua funciona)", async () => {
    const extraction = await extractOriginal("pdf", pdf("04-ruidoso.pdf"));
    const raw = extraction.pages.flatMap((page) => page.blocks.map((b) => b.text)).join("\n");
    expect(noiseCategories(raw)).toEqual(expect.arrayContaining(["advertisement", "email", "social_handle", "source_reference", "url", "watermark"]));
  });
  it("termos de curso/professor informados pela usuária são removidos do corpo", async () => {
    const extraction = doc([block("body", "O conceito foi explicado pela Escola Alfa no módulo anterior. A Constituição prevê a assistência jurídica.")]);
    const result = cleanDocument(extraction, { knownTerms: ["Escola Alfa"] });
    expect(result.text).toBe("O conceito foi explicado pela no módulo anterior. A Constituição prevê a assistência jurídica.");
    expect(result.removed).toEqual([{ category: "known_term", count: 1 }]);
  });
});

describe("citações preservadas verbatim (Contrato de Saída, item 2)", () => {
  it("lei, súmula, julgado e autor saem idênticos às fontes", async () => {
    const result = await clean("05-citacoes.pdf");
    const extraction = await extractOriginal("pdf", pdf("05-citacoes.pdf"));
    const original = extraction.pages[0].blocks.map((b) => b.text).join("\n\n");
    expect(result.text).toBe(original);
    expect(result.removed).toEqual([]);
    for (const citation of ["Art. 134. A Defensoria Pública é instituição permanente", "na forma do inciso LXXIV do art. 5º desta Constituição Federal.", "Art. 5º, LXXIV - o Estado prestará assistência jurídica integral e gratuita aos que comprovarem insuficiência de recursos;", "Súmula 421 do STJ: Os honorários advocatícios", "REsp 0000000/XX (julgado fictício), Rel. Min. Exemplo, Segunda Turma, julgado em 01/01/2020", "Autor Exemplo, Manual Fictício de Processo, p. 123,"]) {
      expect(result.text, citation).toContain(citation);
    }
  });
});

describe("conservadorismo: texto jurídico legítimo nunca é removido", () => {
  const legal = [
    "A promoção dos direitos humanos e a defesa dos necessitados incumbem à Defensoria Pública.",
    "O desconto em folha de pagamento depende de autorização expressa do servidor.",
    "A sentença foi proferida conforme o material probatório constante dos autos.",
    "Segundo o curso natural do processo, o recurso será apreciado pelo tribunal.",
    "O acesso à justiça é garantia fundamental. Veja o art. 5º, XXXV, da Constituição Federal.",
    "O Ministro Relator citou a página 12 da petição inicial e o parecer do Prof. Celso Antônio Bandeira de Mello.",
    "A inscrição no cadastro e a matrícula do imóvel constam do registro público.",
    "Cf. Resp 1.234.567/SP, Rel. Min. Fulano, j. 10/10/2020, DJe 15/10/2020; STF, RE 592.581/RS, Tema 220.",
    "O prazo é de 15 dias (art. 219 do CPC), contados em dias úteis, e a vista aos autos é franqueada.",
  ];
  it.each(legal)("preserva: %s", (sentence) => {
    const result = cleanDocument(doc([block("body", sentence)]));
    expect(result.text).toBe(sentence);
    expect(result.removed).toEqual([]);
    expect(findNoise(sentence)).toEqual([]);
  });
  it("citação de autor com 'Prof.' fica no texto e vai para revisão (não é removida por regra)", () => {
    const result = cleanDocument(doc([block("body", "Para o Prof. Celso Antônio Bandeira de Mello, o ato é vinculado.")]));
    expect(result.text).toContain("Prof. Celso Antônio Bandeira de Mello");
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: "possible_professor_mention" })]);
  });
});

describe("regras de cabeçalho, rodapé e repetição", () => {
  it("linha repetida NO CORPO não é apagada (defeito do limpador antigo): vai para revisão", () => {
    const result = cleanDocument(doc([block("body", "Conceito de hipossuficiência"), block("body", "Texto da página um com conteúdo real.")], [block("body", "Conceito de hipossuficiência"), block("body", "Texto da página dois com outro conteúdo.")]));
    expect(result.text.match(/Conceito de hipossuficiência/g)).toHaveLength(2);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: "repeated_short_text", pages: [1, 2] })]);
  });
  it("cabeçalho repetido em várias páginas é removido mesmo com número de página diferente", () => {
    const page = (n: number) => [block("header", `Apostila de Direito - página ${n}`), block("body", `Conteúdo único da página ${n} com texto suficiente.`), block("footer", String(n))];
    const result = cleanDocument(doc(page(1), page(2), page(3)));
    expect(result.text).toBe("Conteúdo único da página 1 com texto suficiente.\n\nConteúdo único da página 2 com texto suficiente.\n\nConteúdo único da página 3 com texto suficiente.");
  });
  it("documento de 1 página: cabeçalho com marca d'água sai por inteiro; cabeçalho limpo e único é mantido", () => {
    const noisy = cleanDocument(doc([block("header", "CURSO ALFA - Licensed to Ana - ana@example.com - 111.111.111-11 Última atualização: 01/01/2026"), block("body", "Conteúdo da aula sobre a defensoria pública."), block("footer", "3")]));
    expect(noisy.text).toBe("Conteúdo da aula sobre a defensoria pública.");
    const plain = cleanDocument(doc([block("header", "Resumo de Direito Civil"), block("body", "Conteúdo sobre obrigações e contratos.")]));
    expect(plain.text).toContain("Resumo de Direito Civil");
  });
  it("parágrafo cortado pela quebra de página é costurado, com as duas páginas registradas", () => {
    const result = cleanDocument(doc([block("body", "A hipossuficiência organizacional amplia o público e")], [block("body", "exige análise do caso concreto pelo órgão.")]));
    expect(result.paragraphs).toEqual([expect.objectContaining({ text: "A hipossuficiência organizacional amplia o público e exige análise do caso concreto pelo órgão.", pages: [1, 2] })]);
  });
  it("não costura quando o parágrafo anterior termina em ponto ou o seguinte é título", () => {
    expect(cleanDocument(doc([block("body", "Fim da ideia.")], [block("body", "começa em minúscula mas o anterior fechou.")])).paragraphs).toHaveLength(2);
    expect(cleanDocument(doc([block("body", "Frase sem ponto")], [block("body", "TÍTULO NOVO", true)])).paragraphs).toHaveLength(2);
  });
  it("marcador estrutural de curso ('Aula 3') fica no texto e é sinalizado", () => {
    const result = cleanDocument(doc([block("body", "Aula 3"), block("body", "Conteúdo da aula.")]));
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: "course_structure_marker" })]);
  });
});

describe("invariantes da limpeza", () => {
  const files = ["01-texto-simples.pdf", "04-ruidoso.pdf", "05-citacoes.pdf", "09-duas-colunas.pdf", "10-tabela.pdf", "11-notas-de-rodape.pdf", "12-misto.pdf"];
  it.each(files)("%s: só REMOVE (nenhuma palavra nova é criada)", async (name) => {
    const extraction = await extractOriginal("pdf", pdf(name));
    const input = new Set(words(extraction.pages.flatMap((page) => page.blocks.map((b) => b.text)).join(" ")));
    const result = cleanDocument(extraction);
    const invented = words(result.text).filter((word) => !input.has(word));
    expect(invented).toEqual([]);
  });
  it.each(files)("%s: idempotente (limpar o resultado de novo não muda nada)", async (name) => {
    const first = await clean(name);
    const again = cleanDocument(doc(first.paragraphs.map((p) => block(p.kind === "table" ? "table" : p.kind === "footnote" ? "footnote" : "body", p.text))));
    expect(again.text).toBe(first.text);
  });
  it("documento sem texto não produz nada e propaga os avisos de OCR", async () => {
    const result = await clean("06-digitalizado.pdf");
    expect(result.text).toBe("");
    expect(result.paragraphs).toEqual([]);
    expect(result.warnings[0]).toMatch(/OCR não está habilitado/);
  });
});

describe("verificador de ruído", () => {
  it.each([
    ["nome de arquivo", "veja o arquivo Direito+Administrativo+-+Ponto+1.pdf para detalhes", "file_name"],
    ["página do PDF", "[Página 12] texto e Página 3 de 20", "page_reference"],
    ["url", "acesse https://exemplo.com.br/a ou www.exemplo.org", "url"],
    ["e-mail", "fale com contato@exemplo.com.br", "email"],
    ["perfil social", "siga @cursoexemplo hoje", "social_handle"],
    ["qr code", "escaneie o QR code abaixo", "qr_code"],
    ["propaganda", "MATRICULE-SE com 30% de desconto", "advertisement"],
    ["referência ao material", "conforme o material de apoio, aula 3", "source_reference"],
    ["marca do pipeline", "[chunk 3] e trecho 7 do documento", "pipeline_mark"],
    ["fala da IA", "Claro, aqui está o resumo do tema", "ai_talk"],
    ["numeração isolada", "texto\n12\ntexto", "page_number"],
    ["marca d'água", "Licensed to Ana - a@b.com - 111.111.111-11 Última atualização: 01/01/2026", "watermark"],
    ["hifenização partida", "responsabi-\nlidade", "hyphen_break"],
  ])("detecta %s", (_label, text, category) => {
    expect(noiseCategories(text)).toContain(category);
  });
  it("detecta termos informados e ignora o que é conteúdo", () => {
    expect(noiseCategories("pela Escola Alfa", { knownTerms: ["Escola Alfa"] })).toEqual(["known_term"]);
    expect(findNoise("Segundo Autor Exemplo, Manual, p. 123, o tema é claro. A promoção dos direitos é dever.")).toEqual([]);
  });
});

describe("divisão em sentenças", () => {
  it("não quebra em abreviações jurídicas e numeração", () => {
    expect(splitSentences("Art. 134. A Defensoria Pública é essencial. Veja o art. 5º, LXXIV.")).toEqual(["Art. 134. A Defensoria Pública é essencial.", "Veja o art. 5º, LXXIV."]);
    expect(splitSentences("Rel. Min. Fulano, j. 10/10/2020. Outra frase.")).toEqual(["Rel. Min. Fulano, j. 10/10/2020.", "Outra frase."]);
    expect(splitSentences("O prazo termina em 2020. Depois disso, não cabe recurso.")).toEqual(["O prazo termina em 2020.", "Depois disso, não cabe recurso."]);
  });
  it("não quebra dentro de URL", () => {
    expect(splitSentences("Acesse www.exemplo.com.br/bonus e baixe. Siga @perfil.")).toEqual(["Acesse www.exemplo.com.br/bonus e baixe.", "Siga @perfil."]);
  });
});
