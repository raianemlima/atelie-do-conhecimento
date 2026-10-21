import { listDocuments } from "@/lib/document-store";
import { readCollection, type Chapter, type Project, type Source } from "@/lib/local-store";
import { createClient } from "@/lib/supabase/client";
import { listRemoteDocuments, uploadRemoteDocument } from "@/lib/supabase/data-store";

export type MigrationSummary = { projects: number; sources: number; chapters: number; documents: number; skipped: number };

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

export async function migrateLegacyData(): Promise<MigrationSummary> {
  const supabase = createClient();
  const [projects, sources, chapters, documents, remoteDocuments] = await Promise.all([readCollection<Project>("projects"), readCollection<Source>("sources"), readCollection<Chapter>("chapters"), listDocuments(), listRemoteDocuments()]);
  const summary: MigrationSummary = { projects: 0, sources: 0, chapters: 0, documents: 0, skipped: 0 };
  const projectIds = new Map<string, string>();
  for (const project of projects) {
    const id = isUuid(project.id) ? project.id : crypto.randomUUID();
    const { error } = await supabase.from("projects").upsert({ id, name: project.name, subject: project.subject, description: project.description, created_at: project.createdAt, updated_at: project.updatedAt }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Não foi possível migrar projetos. ${error.message}`);
    projectIds.set(project.id, id); summary.projects += 1;
  }
  for (const source of sources) {
    const id = isUuid(source.id) ? source.id : crypto.randomUUID();
    const { error } = await supabase.from("sources").upsert({ id, title: source.title, type: source.type, url: source.url, notes: source.notes, project_id: source.projectId ? (projectIds.get(source.projectId) ?? null) : null, created_at: source.createdAt }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Não foi possível migrar fontes. ${error.message}`);
    summary.sources += 1;
  }
  for (const chapter of chapters) {
    const id = isUuid(chapter.id) ? chapter.id : crypto.randomUUID();
    const { error } = await supabase.from("chapters").upsert({ id, title: chapter.title, content: chapter.content, status: chapter.status, project_id: chapter.projectId ? (projectIds.get(chapter.projectId) ?? null) : null, updated_at: chapter.updatedAt }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Não foi possível migrar capítulos. ${error.message}`);
    summary.chapters += 1;
  }
  const existingHashes = new Set(remoteDocuments.map((document) => document.sha256));
  for (const document of documents) {
    if (existingHashes.has(document.sha256)) { summary.skipped += 1; continue; }
    const id = crypto.randomUUID();
    await uploadRemoteDocument({ id, file: new File([document.original], document.fileName), metadata: { id, title: document.title, fileName: document.fileName, format: document.format, size: document.size, importedAt: document.importedAt, projectId: document.projectId ? (projectIds.get(document.projectId) ?? null) : null, sha256: document.sha256, extractionStatus: document.extractionStatus, extractedText: document.extractedText, pageTexts: document.pageTexts, pageCount: document.pageCount } });
    summary.documents += 1; existingHashes.add(document.sha256);
  }
  return summary;
}
