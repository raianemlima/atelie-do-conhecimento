import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CORPUS_DIR } from "../helpers";
import { buildStoragePath, inspectContent, MAX_FILE_NAME_LENGTH, MAX_UPLOAD_BATCH, MAX_UPLOAD_BYTES, sha256Hex, validateBatchSize, validateDeclaredSize, validateFileName, verifyUploadedObject } from "@/lib/server/upload-rules";

const corpus = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));
const text = (value: string) => new TextEncoder().encode(value);

async function makeDocx(withDocumentXml: boolean) {
  const zip = new JSZip();
  zip.file(withDocumentXml ? "word/document.xml" : "outro.xml", "<w:document/>");
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("validateFileName", () => {
  it.each([["a.pdf", "pdf"], ["Aula 1.DOCX", "docx"], ["notas.md", "md"], ["t.txt", "txt"]])("aceita %s", (name, format) => {
    expect(validateFileName(name)).toEqual({ ok: true, format });
  });
  it.each([
    ["", "invalid_name"], ["   ", "invalid_name"], [undefined, "invalid_name"], [42, "invalid_name"],
    ["../segredo.pdf", "invalid_name"], ["a/b.pdf", "invalid_name"], ["a\\b.pdf", "invalid_name"], ["a\u0000.pdf", "invalid_name"], ["a\n.pdf", "invalid_name"],
    ["x".repeat(MAX_FILE_NAME_LENGTH + 1) + ".pdf", "invalid_name"],
    ["programa.exe", "unsupported_format"], ["sem-extensao", "unsupported_format"], ["a.pdf.exe", "unsupported_format"],
  ])("rejeita %j", (name, code) => {
    expect(validateFileName(name)).toMatchObject({ ok: false, code });
  });
});

describe("tamanho e lote", () => {
  it("valida tamanho declarado", () => {
    expect(validateDeclaredSize(1)).toMatchObject({ ok: true });
    expect(validateDeclaredSize(0)).toMatchObject({ ok: false, code: "empty" });
    expect(validateDeclaredSize(MAX_UPLOAD_BYTES + 1)).toMatchObject({ ok: false, code: "too_large" });
    expect(validateDeclaredSize(-5)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(validateDeclaredSize(1.5)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(validateDeclaredSize("10")).toMatchObject({ ok: false, code: "invalid_request" });
  });
  it("valida quantidade do lote", () => {
    expect(validateBatchSize(MAX_UPLOAD_BATCH)).toMatchObject({ ok: true });
    expect(validateBatchSize(MAX_UPLOAD_BATCH + 1)).toMatchObject({ ok: false, code: "too_many" });
    expect(validateBatchSize(0)).toMatchObject({ ok: false, code: "invalid_request" });
  });
});

describe("inspectContent (conteúdo real, não o declarado)", () => {
  it("aceita todos os PDFs íntegros do corpus", async () => {
    for (const name of ["01-texto-simples.pdf", "04-ruidoso.pdf", "05-citacoes.pdf", "06-digitalizado.pdf", "08-protegido.pdf"]) {
      expect(await inspectContent(corpus(name), "pdf"), name).toEqual({ ok: true });
    }
  });
  it("detecta PDF truncado/corrompido", async () => {
    expect(await inspectContent(corpus("07-corrompido.pdf"), "pdf")).toMatchObject({ ok: false, code: "truncated" });
  });
  it("detecta executável renomeado para .pdf", async () => {
    expect(await inspectContent(text("MZ\u0090\u0000\u0003 programa"), "pdf")).toMatchObject({ ok: false, code: "format_mismatch" });
  });
  it("detecta PDF declarado como DOCX e DOCX declarado como PDF", async () => {
    expect(await inspectContent(corpus("01-texto-simples.pdf"), "docx")).toMatchObject({ ok: false, code: "format_mismatch" });
    expect(await inspectContent(await makeDocx(true), "pdf")).toMatchObject({ ok: false, code: "format_mismatch" });
  });
  it("valida a estrutura do DOCX", async () => {
    expect(await inspectContent(await makeDocx(true), "docx")).toEqual({ ok: true });
    expect(await inspectContent(await makeDocx(false), "docx")).toMatchObject({ ok: false, code: "corrupted" });
    expect(await inspectContent(text("PK não é zip de verdade"), "docx")).toMatchObject({ ok: false, code: "corrupted" });
  });
  it("aceita texto UTF-8 e rejeita binário e UTF-8 inválido", async () => {
    expect(await inspectContent(text("# Título\nConteúdo com acentuação"), "md")).toEqual({ ok: true });
    expect(await inspectContent(new Uint8Array([0x41, 0x00, 0x42]), "txt")).toMatchObject({ ok: false, code: "format_mismatch" });
    expect(await inspectContent(new Uint8Array([0xff, 0xfe, 0xfd]), "txt")).toMatchObject({ ok: false, code: "format_mismatch" });
  });
});

describe("verifyUploadedObject", () => {
  const bytes = corpus("01-texto-simples.pdf");
  const declared = { fileName: "01.pdf", format: "pdf" as const, size: bytes.length, sha256: sha256Hex(bytes) };
  it("aprova quando tudo confere", async () => {
    expect(await verifyUploadedObject(declared, bytes)).toEqual({ ok: true, sha256: declared.sha256, size: bytes.length });
  });
  it("rejeita tamanho diferente do declarado", async () => {
    expect(await verifyUploadedObject({ ...declared, size: bytes.length + 1 }, bytes)).toMatchObject({ ok: false, code: "size_mismatch" });
  });
  it("rejeita hash diferente do declarado", async () => {
    expect(await verifyUploadedObject({ ...declared, sha256: "0".repeat(64) }, bytes)).toMatchObject({ ok: false, code: "hash_mismatch" });
  });
  it("rejeita conteúdo inválido mesmo com tamanho e hash coerentes", async () => {
    const fake = text("MZ binário disfarçado");
    expect(await verifyUploadedObject({ fileName: "x.pdf", format: "pdf", size: fake.length, sha256: sha256Hex(fake) }, fake)).toMatchObject({ ok: false, code: "format_mismatch" });
  });
});

describe("isolamento por caminho de armazenamento", () => {
  it("o caminho sempre começa pelo id do usuário autenticado e neutraliza o nome", () => {
    const path = buildStoragePath("user-1", "doc-1", "Aula de Direito (v2).pdf");
    expect(path.startsWith("user-1/doc-1/")).toBe(true);
    expect(path).toBe("user-1/doc-1/Aula-de-Direito-v2-.pdf");
    expect(buildStoragePath("user-1", "doc-1", "///").includes("..")).toBe(false);
  });
});
