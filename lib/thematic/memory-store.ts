import { randomUUID } from "node:crypto";
import { StaleMapError, type MapVersion, type MapVersionSummary, type ThematicMapStore } from "@/lib/thematic/store";

export class MemoryMapStore implements ThematicMapStore {
  readonly versions: MapVersion[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private forNotebook(notebookId: string) { return this.versions.filter((v) => v.notebookId === notebookId).sort((a, b) => a.version - b.version); }

  async saveAuto(input: { notebookId: string; jobId: string; map: MapVersion["map"] }) {
    const existing = this.versions.find((v) => v.notebookId === input.notebookId && v.sourceJobId === input.jobId);
    if (existing) return existing;
    const version = this.forNotebook(input.notebookId).length + 1;
    const row: MapVersion = { id: randomUUID(), notebookId: input.notebookId, version, baseVersion: null, sourceJobId: input.jobId, origin: "auto", status: "draft", confirmedAt: null, discipline: input.map.discipline, map: structuredClone(input.map), changeLog: [], createdAt: this.clock().toISOString() };
    this.versions.push(row);
    return row;
  }

  async saveEdited(input: { notebookId: string; baseVersion: number; expectedLatest: number; map: MapVersion["map"]; changeLog: string[] }) {
    const all = this.forNotebook(input.notebookId);
    if ((all.at(-1)?.version ?? 0) !== input.expectedLatest) throw new StaleMapError();
    const row: MapVersion = { id: randomUUID(), notebookId: input.notebookId, version: all.length + 1, baseVersion: input.baseVersion, sourceJobId: null, origin: "edited", status: "draft", confirmedAt: null, discipline: input.map.discipline, map: structuredClone(input.map), changeLog: [...input.changeLog], createdAt: this.clock().toISOString() };
    this.versions.push(row);
    return row;
  }

  async latest(notebookId: string) { const all = this.forNotebook(notebookId); return all.at(-1) ?? null; }
  async get(notebookId: string, version: number) { return this.forNotebook(notebookId).find((v) => v.version === version) ?? null; }

  async list(notebookId: string): Promise<MapVersionSummary[]> {
    return this.forNotebook(notebookId).map(({ version, baseVersion, origin, status, createdAt, confirmedAt }) => ({ version, baseVersion, origin, status, createdAt, confirmedAt }));
  }

  async confirm(notebookId: string, version: number) {
    const target = await this.get(notebookId, version);
    if (!target) return null;
    this.forNotebook(notebookId).forEach((v) => { if (v.status === "confirmed") { v.status = "draft"; v.confirmedAt = null; } });
    target.status = "confirmed";
    target.confirmedAt = this.clock().toISOString();
    return target;
  }
}
