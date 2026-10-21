import type { Chapter, Project, Source } from "@/lib/local-store";
import type { DocumentFormat, ExtractionStatus } from "@/lib/document-types";
import { createClient } from "@/lib/supabase/client";

type ProjectRow = {
  id: string;
  name: string;
  subject: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: string;
  title: string;
  type: Source["type"];
  url: string;
  notes: string;
  created_at: string;
  project_id: string | null;
};

type ChapterRow = {
  id: string;
  title: string;
  content: string;
  status: Chapter["status"];
  updated_at: string;
  project_id: string | null;
};

export type RemoteDocument = {
  id: string;
  title: string;
  fileName: string;
  format: DocumentFormat;
  size: number;
  importedAt: string;
  projectId: string | null;
  sha256: string;
  extractionStatus: ExtractionStatus;
  extractedText: string;
  pageTexts: string[];
  pageCount: number;
  storagePath: string;
};

type DocumentRow = {
  id: string;
  title: string;
  file_name: string;
  format: DocumentFormat;
  size: number;
  imported_at: string;
  project_id: string | null;
  sha256: string;
  extraction_status: ExtractionStatus;
  extracted_text: string;
  page_texts: string[];
  page_count: number;
  storage_path: string;
};

function throwIfError(error: { message: string } | null, fallback: string): void {
  if (error) throw new Error(`${fallback} ${error.message}`);
}

function mapProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, subject: row.subject, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapSource(row: SourceRow): Source {
  return { id: row.id, title: row.title, type: row.type, url: row.url, notes: row.notes, createdAt: row.created_at, projectId: row.project_id };
}

function mapChapter(row: ChapterRow): Chapter {
  return { id: row.id, title: row.title, content: row.content, status: row.status, updatedAt: row.updated_at, projectId: row.project_id };
}

function mapDocument(row: DocumentRow): RemoteDocument {
  return { id: row.id, title: row.title, fileName: row.file_name, format: row.format, size: Number(row.size), importedAt: row.imported_at, projectId: row.project_id, sha256: row.sha256, extractionStatus: row.extraction_status, extractedText: row.extracted_text, pageTexts: row.page_texts ?? [], pageCount: row.page_count, storagePath: row.storage_path };
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await createClient().from("projects").select("*").order("created_at", { ascending: false });
  throwIfError(error, "Não foi possível carregar os projetos.");
  return ((data ?? []) as unknown as ProjectRow[]).map(mapProject);
}

export async function createProject(input: Pick<Project, "name" | "subject" | "description">): Promise<Project> {
  const { data, error } = await createClient().from("projects").insert({ name: input.name, subject: input.subject, description: input.description }).select("*").single();
  throwIfError(error, "Não foi possível salvar o projeto.");
  return mapProject(data as unknown as ProjectRow);
}

export async function listSources(projectId?: string): Promise<Source[]> {
  let query = createClient().from("sources").select("*").order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  throwIfError(error, "Não foi possível carregar as fontes.");
  return ((data ?? []) as unknown as SourceRow[]).map(mapSource);
}

export async function createSource(input: Pick<Source, "title" | "type" | "url" | "notes" | "projectId">): Promise<Source> {
  const { data, error } = await createClient().from("sources").insert({ title: input.title, type: input.type, url: input.url, notes: input.notes, project_id: input.projectId }).select("*").single();
  throwIfError(error, "Não foi possível salvar a fonte.");
  return mapSource(data as unknown as SourceRow);
}

export async function removeSource(id: string): Promise<void> {
  const { error } = await createClient().from("sources").delete().eq("id", id);
  throwIfError(error, "Não foi possível remover a fonte.");
}

export async function listChapters(projectId?: string): Promise<Chapter[]> {
  let query = createClient().from("chapters").select("*").order("updated_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  throwIfError(error, "Não foi possível carregar os capítulos.");
  return ((data ?? []) as unknown as ChapterRow[]).map(mapChapter);
}

export async function createChapter(input: Pick<Chapter, "title" | "content" | "status" | "projectId">): Promise<Chapter> {
  const { data, error } = await createClient().from("chapters").insert({ title: input.title, content: input.content, status: input.status, project_id: input.projectId }).select("*").single();
  throwIfError(error, "Não foi possível criar o capítulo.");
  return mapChapter(data as unknown as ChapterRow);
}

export async function updateChapter(id: string, input: Pick<Chapter, "title" | "content" | "status" | "projectId">): Promise<Chapter> {
  const { data, error } = await createClient().from("chapters").update({ title: input.title, content: input.content, status: input.status, project_id: input.projectId, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  throwIfError(error, "Não foi possível atualizar o capítulo.");
  return mapChapter(data as unknown as ChapterRow);
}

export async function listRemoteDocuments(): Promise<RemoteDocument[]> {
  const { data, error } = await createClient().from("documents").select("*").order("imported_at", { ascending: false });
  throwIfError(error, "Não foi possível carregar a biblioteca documental.");
  return ((data ?? []) as unknown as DocumentRow[]).map(mapDocument);
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "documento";
}

export async function uploadRemoteDocument(input: { id: string; file: File; metadata: Omit<RemoteDocument, "storagePath"> }): Promise<RemoteDocument> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  throwIfError(userError, "Não foi possível confirmar a sessão.");
  if (!userData.user) throw new Error("Sua sessão expirou. Entre novamente para importar documentos.");
  const storagePath = `${userData.user.id}/${input.id}/${safeFileName(input.file.name)}`;
  const contentTypes: Record<DocumentFormat, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", md: "text/markdown", txt: "text/plain" };
  const upload = await supabase.storage.from("documents").upload(storagePath, input.file, { contentType: contentTypes[input.metadata.format], upsert: false });
  throwIfError(upload.error, "Não foi possível enviar o original para o armazenamento privado.");
  const row = { id: input.id, project_id: input.metadata.projectId, title: input.metadata.title, file_name: input.metadata.fileName, format: input.metadata.format, size: input.metadata.size, imported_at: input.metadata.importedAt, sha256: input.metadata.sha256, extraction_status: input.metadata.extractionStatus, extracted_text: input.metadata.extractedText, page_texts: input.metadata.pageTexts, page_count: input.metadata.pageCount, storage_path: storagePath };
  const { data, error } = await supabase.from("documents").insert(row).select("*").single();
  if (error) {
    const cleanup = await supabase.storage.from("documents").remove([storagePath]);
    const cleanupMessage = cleanup.error ? ` A limpeza do original também falhou: ${cleanup.error.message}` : "";
    throw new Error(`Não foi possível salvar os metadados do documento. ${error.message}.${cleanupMessage}`);
  }
  return mapDocument(data as unknown as DocumentRow);
}

export async function downloadRemoteDocument(storagePath: string): Promise<Blob> {
  const { data, error } = await createClient().storage.from("documents").download(storagePath);
  throwIfError(error, "Não foi possível abrir o arquivo original.");
  if (!data) throw new Error("O arquivo original não foi encontrado no armazenamento privado.");
  return data;
}

export async function removeRemoteDocument(document: RemoteDocument): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("documents").delete().eq("id", document.id);
  throwIfError(error, "Não foi possível remover os metadados do documento.");
  const { error: storageError } = await supabase.storage.from("documents").remove([document.storagePath]);
  if (storageError) {
    throw new Error(`Os metadados foram removidos, mas não foi possível remover o arquivo original. ${storageError.message}`);
  }
}
