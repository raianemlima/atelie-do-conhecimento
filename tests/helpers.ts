import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractDocumentText } from "@/lib/document-extractor";

export const CORPUS_DIR = join(process.cwd(), "tests", "golden", "pdfs");

export function corpusBlob(name: string): Blob {
  return new Blob([readFileSync(join(CORPUS_DIR, name))]);
}

export function corpusFile(name: string, type = "application/pdf"): File {
  return new File([readFileSync(join(CORPUS_DIR, name))], name, { type });
}

export function extractCorpus(name: string) {
  return extractDocumentText(corpusBlob(name), "pdf");
}

// Padrões de ruído que o Contrato de Saída proíbe na apostila (usado como régua nas fases seguintes).
export const NOISE_PROBES: Record<string, RegExp> = {
  "nome de curso": /curso exemplo/i,
  "professor": /prof\.?\s+fulano/i,
  "url": /(?:https?:\/\/|www\.)\S+|\b\S+\.(?:com\.br|com)\b/i,
  "e-mail": /[\w.+-]+@[\w-]+\.[\w.]+/i,
  "perfil social": /@\w{3,}/,
  "licenciamento": /licensed to|última atualização/i,
  "propaganda": /matricule-se|desconto|pacote completo/i,
  "referência a material": /conforme o material/i,
  "numeração de página isolada": /(?:^|\n)\d{1,3}(?:\n|$)/,
  "hifenização partida": /[a-zà-ú]-\n[a-zà-ú]/i,
};

export function findResidualNoise(text: string): string[] {
  return Object.entries(NOISE_PROBES).filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}
