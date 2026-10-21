import { randomUUID } from "node:crypto";
import { sha256 } from "@/lib/pipeline/hash";
import { DRAFT_PROMPT_VERSION } from "@/lib/drafting/prompt";
import type { DraftInput, ThemeDraftResult } from "@/lib/drafting/types";

export type VersionedTheme = { fingerprint: string; title: string; result: ThemeDraftResult };
export type DraftVersion = {
  id: string;
  notebookId: string;
  version: number;
  baseVersion: number | null;
  sourceJobId: string | null;
  origin: "generated" | "restored";
  themes: Record<string, VersionedTheme>;
  order: string[];
  createdAt: string;
};

// Muda quando o tema, os trechos, as citações aplicáveis ou o prompt mudam: só então o tema é refeito.
export function themeFingerprint(input: DraftInput): string {
  return sha256(JSON.stringify({ prompt: DRAFT_PROMPT_VERSION, title: input.title, path: input.path, sources: input.sources.map((s) => [s.segmentId, s.text]), citations: input.citations.map((c) => [c.key, c.statements]) }));
}

export type IncrementalPlan = { reuse: string[]; redo: DraftInput[]; removed: string[] };

export function planIncremental(inputs: DraftInput[], previous: DraftVersion | null): IncrementalPlan {
  const reuse: string[] = [];
  const redo: DraftInput[] = [];
  for (const input of inputs) {
    const before = previous?.themes[input.themeId];
    if (before && before.fingerprint === themeFingerprint(input) && before.result.draft) reuse.push(input.themeId);
    else redo.push(input);
  }
  const current = new Set(inputs.map((input) => input.themeId));
  return { reuse, redo, removed: previous ? Object.keys(previous.themes).filter((id) => !current.has(id)) : [] };
}

export type VersionDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: string[] };

export function diffVersions(from: DraftVersion, to: DraftVersion): VersionDiff {
  const ids = (version: DraftVersion) => new Set(Object.keys(version.themes));
  const before = ids(from), after = ids(to);
  const both = [...after].filter((id) => before.has(id));
  const same = (id: string) => JSON.stringify(from.themes[id].result.draft) === JSON.stringify(to.themes[id].result.draft);
  return { added: [...after].filter((id) => !before.has(id)), removed: [...before].filter((id) => !after.has(id)), changed: both.filter((id) => !same(id)), unchanged: both.filter(same) };
}

// Versões são imutáveis. Restaurar cria uma NOVA versão com o conteúdo da antiga.
export interface DraftVersionStore {
  // Idempotente por job: salvar duas vezes o mesmo job devolve a versão já criada.
  saveGenerated(input: { notebookId: string; jobId: string; themes: Record<string, VersionedTheme>; order: string[] }): Promise<DraftVersion>;
  restore(notebookId: string, version: number): Promise<DraftVersion | null>;
  latest(notebookId: string): Promise<DraftVersion | null>;
  get(notebookId: string, version: number): Promise<DraftVersion | null>;
  list(notebookId: string): Promise<Pick<DraftVersion, "version" | "baseVersion" | "origin" | "createdAt">[]>;
  // Progresso dentro de um job: se a IA falhar no meio, a retomada não paga de novo pelos temas já prontos.
  saveProgress(jobId: string, themeId: string, theme: VersionedTheme): Promise<void>;
  loadProgress(jobId: string): Promise<Record<string, VersionedTheme>>;
}

export class MemoryDraftStore implements DraftVersionStore {
  readonly versions: DraftVersion[] = [];
  private readonly progress = new Map<string, Record<string, VersionedTheme>>();
  constructor(private readonly clock: () => Date = () => new Date()) {}
  private of(notebookId: string) { return this.versions.filter((v) => v.notebookId === notebookId).sort((a, b) => a.version - b.version); }

  async saveGenerated(input: { notebookId: string; jobId: string; themes: Record<string, VersionedTheme>; order: string[] }) {
    const existing = this.versions.find((v) => v.notebookId === input.notebookId && v.sourceJobId === input.jobId);
    if (existing) return existing;
    const all = this.of(input.notebookId);
    const row: DraftVersion = { id: randomUUID(), notebookId: input.notebookId, version: all.length + 1, baseVersion: all.at(-1)?.version ?? null, sourceJobId: input.jobId, origin: "generated", themes: structuredClone(input.themes), order: [...input.order], createdAt: this.clock().toISOString() };
    this.versions.push(row);
    return row;
  }
  async restore(notebookId: string, version: number) {
    const target = await this.get(notebookId, version);
    if (!target) return null;
    const row: DraftVersion = { id: randomUUID(), notebookId, version: this.of(notebookId).length + 1, baseVersion: version, sourceJobId: null, origin: "restored", themes: structuredClone(target.themes), order: [...target.order], createdAt: this.clock().toISOString() };
    this.versions.push(row);
    return row;
  }
  async latest(notebookId: string) { return this.of(notebookId).at(-1) ?? null; }
  async get(notebookId: string, version: number) { return this.of(notebookId).find((v) => v.version === version) ?? null; }
  async list(notebookId: string) { return this.of(notebookId).map(({ version, baseVersion, origin, createdAt }) => ({ version, baseVersion, origin, createdAt })); }
  async saveProgress(jobId: string, themeId: string, theme: VersionedTheme) { this.progress.set(jobId, { ...(this.progress.get(jobId) ?? {}), [themeId]: structuredClone(theme) }); }
  async loadProgress(jobId: string) { return this.progress.get(jobId) ?? {}; }
}
