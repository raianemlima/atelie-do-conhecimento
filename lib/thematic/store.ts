import type { ThematicMap } from "@/lib/thematic/types";

export type MapVersion = {
  id: string;
  notebookId: string;
  version: number;
  baseVersion: number | null;
  sourceJobId: string | null;
  origin: "auto" | "edited";
  status: "draft" | "confirmed";
  confirmedAt: string | null;
  discipline: string;
  map: ThematicMap;
  changeLog: string[];
  createdAt: string;
};

export type MapVersionSummary = Pick<MapVersion, "version" | "baseVersion" | "origin" | "status" | "createdAt" | "confirmedAt">;

export class StaleMapError extends Error {
  constructor() {
    super("O mapa foi alterado por outra sessão. Recarregue para ver a versão mais recente.");
    this.name = "StaleMapError";
  }
}

// Versões do mapa são imutáveis: editar cria uma nova versão; nada é sobrescrito.
export interface ThematicMapStore {
  // Idempotente por job: salvar duas vezes o mapa do mesmo job devolve a versão já criada.
  saveAuto(input: { notebookId: string; jobId: string; map: ThematicMap }): Promise<MapVersion>;
  // Falha com StaleMapError se expectedLatest não for a versão mais recente.
  saveEdited(input: { notebookId: string; baseVersion: number; expectedLatest: number; map: ThematicMap; changeLog: string[] }): Promise<MapVersion>;
  latest(notebookId: string): Promise<MapVersion | null>;
  get(notebookId: string, version: number): Promise<MapVersion | null>;
  list(notebookId: string): Promise<MapVersionSummary[]>;
  // Só uma versão confirmada por caderno; confirmar outra desconfirma a anterior.
  confirm(notebookId: string, version: number): Promise<MapVersion | null>;
}
