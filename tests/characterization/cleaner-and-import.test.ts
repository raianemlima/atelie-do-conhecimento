import { describe, expect, it } from "vitest";
import { cleanDocumentText } from "@/lib/text-cleaner";
import { DocumentImportError, ensureNotDuplicate, getDocumentFormat, MAX_DOCUMENT_SIZE, suggestDocumentTitle, validateDocumentContent, validateDocumentFile } from "@/lib/document-import";
import { isPipelineV2Enabled } from "@/lib/feature-flags";
import { corpusFile } from "../helpers";

describe("cleanDocumentText — comportamento atual", () => {
  it("remove licenciamento e rodapé colados ao conteúdo", () => {
    const raw = "Licensed to Ana Souza - ana@example.com - 111.111.111-11 Última atualização: 16/01/2026 1 Direito Administrativo Dúvidas e sugestões: contato@curso.example";
    expect(cleanDocumentText(raw)).toBe("1 Direito Administrativo");
  });

  it("junta palavra hifenizada na quebra de linha", () => {
    expect(cleanDocumentText("responsabi-\nlidade civil")).toBe("responsabilidade civil");
  });

  it("remove linha repetida em 2+ páginas (também remove conteúdo legítimo repetido)", () => {
    const pages = ["Título repetido\nA", "Título repetido\nB"];
    expect(cleanDocumentText(pages.join("\n\n"), pages)).toBe("A\n\nB");
  });

  it("remove marcadores '[Página N]' e 'Página N'", () => {
    expect(cleanDocumentText("[Página 3]\nTexto\nPágina 4")).toBe("Texto");
  });

  it("NÃO remove numeração isolada, URL, e-mail genérico nem propaganda (defeitos conhecidos)", () => {
    const out = cleanDocumentText("Texto\n12\nwww.exemplo.com.br\ncontato@exemplo.com");
    expect(out).toContain("12");
    expect(out).toContain("www.exemplo.com.br");
    expect(out).toContain("contato@exemplo.com");
  });
});

describe("importação — validações atuais (somente no navegador/cliente)", () => {
  it("reconhece formatos suportados pela extensão", () => {
    expect(getDocumentFormat(new File(["x"], "a.PDF"))).toBe("pdf");
    expect(getDocumentFormat(new File(["x"], "a.exe"))).toBeNull();
  });

  it("rejeita formato, arquivo vazio e arquivo grande", () => {
    expect(() => validateDocumentFile(new File(["x"], "a.exe"))).toThrow(DocumentImportError);
    expect(() => validateDocumentFile(new File([], "a.pdf"))).toThrow(/vazio/);
    const big = { name: "a.pdf", size: MAX_DOCUMENT_SIZE + 1 } as File;
    expect(() => validateDocumentFile(big)).toThrow(/25 MB/);
  });

  it("valida somente a assinatura (%PDF / PK), não a estrutura real", async () => {
    await expect(validateDocumentContent(new File(["não é pdf"], "a.pdf"), "pdf")).rejects.toThrow(/assinatura PDF/);
    await expect(validateDocumentContent(corpusFile("07-corrompido.pdf"), "pdf")).resolves.toBeUndefined();
  });

  it("detecta duplicata por hash", () => {
    expect(() => ensureNotDuplicate("abc", ["abc"])).toThrow(/já está na biblioteca/);
    expect(() => ensureNotDuplicate("abc", ["def"])).not.toThrow();
  });

  it("sugere título legível a partir de nomes com '+'", () => {
    expect(suggestDocumentTitle("Direito+Administrativo+-+Ponto+1.pdf")).toBe("Direito Administrativo - Ponto 1");
  });
});

describe("feature flag do pipeline v2", () => {
  it("fica desligada por padrão", () => {
    expect(isPipelineV2Enabled(undefined)).toBe(false);
    expect(isPipelineV2Enabled("false")).toBe(false);
  });
  it("liga somente com o valor exato 'true'", () => {
    expect(isPipelineV2Enabled("true")).toBe(true);
  });
});
