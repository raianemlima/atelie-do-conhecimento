import JSZip from "jszip";
import { createId, now, Project, readCollection, Source, Chapter, writeCollection } from "@/lib/local-store";
import { listDocuments, saveDocuments } from "@/lib/document-store";
import type { DocumentMetadata, DocumentRecord } from "@/lib/document-types";

const BACKUP_FORMAT = "atelie-conhecimento-backup";
const BACKUP_VERSION = 1;
const DATA_FILES = ["data/projects.json", "data/sources.json", "data/chapters.json", "data/documents.json"] as const;

export type BackupEntry = { path: string; kind: "json" | "original"; size: number; sha256: string };

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: string;
  records: { projects: number; sources: number; chapters: number; documents: number };
  entries: BackupEntry[];
};

export type BackupPayload = {
  projects: Project[];
  sources: Source[];
  chapters: Chapter[];
  documents: DocumentMetadata[];
  originals: Map<string, Blob>;
};

export type BackupInspection = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest: BackupManifest | null;
  payload: BackupPayload | null;
};

export type RestoreSummary = {
  projectsAdded: number;
  sourcesAdded: number;
  chaptersAdded: number;
  documentsAdded: number;
  duplicatesSkipped: number;
  conflictsCloned: number;
};

const encoder = new TextEncoder();

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const buffer = new Uint8Array(bytes).buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").slice(0, 180) || "documento";
}

function metadataOf(document: DocumentRecord): DocumentMetadata {
  return { id: document.id, title: document.title, fileName: document.fileName, format: document.format, size: document.size, importedAt: document.importedAt, projectId: document.projectId, sha256: document.sha256, extractionStatus: document.extractionStatus, extractedText: document.extractedText, pageTexts: document.pageTexts, pageCount: document.pageCount };
}

async function addEntry(zip: JSZip, path: string, content: string | Uint8Array, kind: BackupEntry["kind"], entries: BackupEntry[]) {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  zip.file(path, bytes);
  entries.push({ path, kind, size: bytes.byteLength, sha256: await sha256(bytes) });
}

export async function exportBackup() {
  const projects = readCollection<Project>("projects");
  const sources = readCollection<Source>("sources");
  const chapters = readCollection<Chapter>("chapters");
  const documents = await listDocuments();
  const zip = new JSZip();
  const entries: BackupEntry[] = [];
  await addEntry(zip, DATA_FILES[0], jsonText(projects), "json", entries);
  await addEntry(zip, DATA_FILES[1], jsonText(sources), "json", entries);
  await addEntry(zip, DATA_FILES[2], jsonText(chapters), "json", entries);
  await addEntry(zip, DATA_FILES[3], jsonText(documents.map(metadataOf)), "json", entries);
  for (const document of documents) {
    const bytes = new Uint8Array(await document.original.arrayBuffer());
    await addEntry(zip, `files/${document.id}/${safeFileName(document.fileName)}`, bytes, "original", entries);
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion: "0.1.0", exportedAt: now(), records: { projects: projects.length, sources: sources.length, chapters: chapters.length, documents: documents.length }, entries };
  zip.file("manifest.json", jsonText(manifest));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function isSafePath(path: string) {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").some((part) => part === ".." || part === ".");
}

function uniqueIds<T extends { id: string }>(records: T[], label: string, errors: string[]) {
  const ids = new Set<string>();
  records.forEach((record) => {
    if (!record?.id || typeof record.id !== "string") errors.push(`${label}: registro sem ID válido.`);
    else if (ids.has(record.id)) errors.push(`${label}: ID duplicado ${record.id}.`);
    ids.add(record.id);
  });
}

export async function inspectBackup(file: Blob): Promise<BackupInspection> {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) return { valid: false, errors: ["O pacote não contém manifest.json."], warnings, manifest: null, payload: null };
    const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
    if (manifest.format !== BACKUP_FORMAT) errors.push("Formato de backup desconhecido.");
    if (manifest.version !== BACKUP_VERSION) errors.push(`Versão de backup não suportada: ${manifest.version}.`);
    if (!Array.isArray(manifest.entries)) errors.push("Manifesto sem lista de integridade.");
    for (const entry of manifest.entries ?? []) {
      if (!isSafePath(entry.path)) { errors.push(`Caminho inseguro no pacote: ${entry.path}.`); continue; }
      const zipEntry = zip.file(entry.path);
      if (!zipEntry) { errors.push(`Arquivo ausente no pacote: ${entry.path}.`); continue; }
      const bytes = await zipEntry.async("uint8array");
      if (bytes.byteLength !== entry.size) errors.push(`Tamanho divergente: ${entry.path}.`);
      if (await sha256(bytes) !== entry.sha256) errors.push(`Checksum divergente: ${entry.path}.`);
    }
    const readJson = async <T>(path: string): Promise<T[]> => {
      const entry = zip.file(path);
      if (!entry) { errors.push(`Dados ausentes: ${path}.`); return []; }
      const parsed = JSON.parse(await entry.async("string"));
      if (!Array.isArray(parsed)) { errors.push(`${path} deveria conter uma lista.`); return []; }
      return parsed as T[];
    };
    const projects = await readJson<Project>(DATA_FILES[0]);
    const sources = await readJson<Source>(DATA_FILES[1]);
    const chapters = await readJson<Chapter>(DATA_FILES[2]);
    const documents = await readJson<DocumentMetadata>(DATA_FILES[3]);
    if (!manifest.records || manifest.records.projects !== projects.length || manifest.records.sources !== sources.length || manifest.records.chapters !== chapters.length || manifest.records.documents !== documents.length) {
      errors.push("As quantidades do manifesto não correspondem aos dados do pacote.");
    }
    uniqueIds(projects, "Projetos", errors); uniqueIds(sources, "Fontes", errors); uniqueIds(chapters, "Capítulos", errors); uniqueIds(documents, "Documentos", errors);
    const projectIds = new Set(projects.map((project) => project.id));
    documents.forEach((document) => { if (document.projectId && !projectIds.has(document.projectId)) warnings.push(`Documento ${document.fileName} aponta para um projeto ausente.`); });
    const originals = new Map<string, Blob>();
    for (const document of documents) {
      const entry = manifest.entries.find((candidate) => candidate.kind === "original" && candidate.path.startsWith(`files/${document.id}/`));
      if (!entry) { errors.push(`Original ausente para o documento ${document.fileName}.`); continue; }
      const zipEntry = zip.file(entry.path);
      if (zipEntry) originals.set(document.id, new Blob([await zipEntry.async("arraybuffer")]));
    }
    const payload = { projects, sources, chapters, documents, originals };
    return { valid: errors.length === 0, errors, warnings, manifest, payload: errors.length === 0 ? payload : null };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? `Pacote inválido: ${error.message}` : "Pacote inválido ou corrompido."], warnings, manifest: null, payload: null };
  }
}

function sameRecord(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneWithNewId<T extends { id: string }>(record: T) {
  return { ...record, id: createId() };
}

export async function restoreBackup(inspection: BackupInspection): Promise<RestoreSummary> {
  if (!inspection.valid || !inspection.payload) throw new Error("O pacote precisa ser validado antes da restauração.");
  const { projects: incomingProjects, sources: incomingSources, chapters: incomingChapters, documents: incomingDocuments, originals } = inspection.payload;
  const currentProjects = readCollection<Project>("projects");
  const currentSources = readCollection<Source>("sources");
  const currentChapters = readCollection<Chapter>("chapters");
  const currentDocuments = await listDocuments();
  const summary: RestoreSummary = { projectsAdded: 0, sourcesAdded: 0, chaptersAdded: 0, documentsAdded: 0, duplicatesSkipped: 0, conflictsCloned: 0 };
  const projectIdMap = new Map<string, string>();
  const mergedProjects = [...currentProjects];
  for (const incoming of incomingProjects) {
    const existing = mergedProjects.find((record) => record.id === incoming.id);
    if (!existing) { mergedProjects.push(incoming); projectIdMap.set(incoming.id, incoming.id); summary.projectsAdded += 1; }
    else if (sameRecord(existing, incoming)) { projectIdMap.set(incoming.id, existing.id); summary.duplicatesSkipped += 1; }
    else { const copy = cloneWithNewId(incoming); mergedProjects.push(copy); projectIdMap.set(incoming.id, copy.id); summary.projectsAdded += 1; summary.conflictsCloned += 1; }
  }
  const mergeSimple = <T extends { id: string }>(current: T[], incoming: T[], count: "sourcesAdded" | "chaptersAdded") => {
    const merged = [...current];
    for (const record of incoming) {
      const existing = merged.find((candidate) => candidate.id === record.id);
      if (!existing) { merged.push(record); summary[count] += 1; }
      else if (sameRecord(existing, record)) summary.duplicatesSkipped += 1;
      else { merged.push(cloneWithNewId(record)); summary[count] += 1; summary.conflictsCloned += 1; }
    }
    return merged;
  };
  const mergedSources = mergeSimple(currentSources, incomingSources, "sourcesAdded");
  const mergedChapters = mergeSimple(currentChapters, incomingChapters, "chaptersAdded");
  const documentsToSave: DocumentRecord[] = [];
  for (const metadata of incomingDocuments) {
    const original = originals.get(metadata.id);
    if (!original) throw new Error(`Original ausente para ${metadata.fileName}.`);
    const existingByHash = currentDocuments.find((document) => document.sha256 === metadata.sha256);
    if (existingByHash) { summary.duplicatesSkipped += 1; continue; }
    const existingById = currentDocuments.find((document) => document.id === metadata.id);
    const id = existingById ? createId() : metadata.id;
    if (existingById) summary.conflictsCloned += 1;
    documentsToSave.push({ ...metadata, id, projectId: metadata.projectId ? (projectIdMap.get(metadata.projectId) ?? metadata.projectId) : null, original });
    summary.documentsAdded += 1;
  }
  const previous = { projects: currentProjects, sources: currentSources, chapters: currentChapters };
  try {
    writeCollection("projects", mergedProjects); writeCollection("sources", mergedSources); writeCollection("chapters", mergedChapters);
    await saveDocuments(documentsToSave);
  } catch (error) {
    writeCollection("projects", previous.projects); writeCollection("sources", previous.sources); writeCollection("chapters", previous.chapters);
    throw error;
  }
  return summary;
}
