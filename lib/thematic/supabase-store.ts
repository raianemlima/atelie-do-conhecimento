import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleMapError, type MapVersion, type MapVersionSummary, type ThematicMapStore } from "@/lib/thematic/store";
import type { ThematicMap } from "@/lib/thematic/types";

type Row = { id: string; notebook_id: string; source_job_id: string | null; version: number; base_version: number | null; origin: "auto" | "edited"; status: "draft" | "confirmed"; confirmed_at: string | null; discipline: string; map: ThematicMap; change_log: string[] | null; created_at: string };

const toVersion = (row: Row): MapVersion => ({ id: row.id, notebookId: row.notebook_id, version: row.version, baseVersion: row.base_version, sourceJobId: row.source_job_id, origin: row.origin, status: row.status, confirmedAt: row.confirmed_at, discipline: row.discipline, map: row.map, changeLog: row.change_log ?? [], createdAt: row.created_at });

function fail(error: { message: string; code?: string } | null, action: string): void {
  if (!error) return;
  if (error.message.includes("stale_map")) throw new StaleMapError();
  throw new Error(`${action}: ${error.message}`);
}

export class SupabaseMapStore implements ThematicMapStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async saveAuto(input: { notebookId: string; jobId: string; map: ThematicMap }) {
    const { data, error } = await this.supabase.rpc("save_thematic_map", { p_notebook_id: input.notebookId, p_source_job_id: input.jobId, p_base_version: null, p_expected_latest: null, p_origin: "auto", p_discipline: input.map.discipline, p_map: input.map, p_change_log: [] });
    fail(error, "Falha ao salvar o mapa temático");
    return toVersion(data as Row);
  }

  async saveEdited(input: { notebookId: string; baseVersion: number; expectedLatest: number; map: ThematicMap; changeLog: string[] }) {
    const { data, error } = await this.supabase.rpc("save_thematic_map", { p_notebook_id: input.notebookId, p_source_job_id: null, p_base_version: input.baseVersion, p_expected_latest: input.expectedLatest, p_origin: "edited", p_discipline: input.map.discipline, p_map: input.map, p_change_log: input.changeLog });
    fail(error, "Falha ao salvar a edição do mapa");
    return toVersion(data as Row);
  }

  async latest(notebookId: string) {
    const { data, error } = await this.supabase.from("thematic_maps").select("*").eq("notebook_id", notebookId).order("version", { ascending: false }).limit(1);
    fail(error, "Falha ao carregar o mapa temático");
    return data && data.length ? toVersion(data[0] as Row) : null;
  }

  async get(notebookId: string, version: number) {
    const { data, error } = await this.supabase.from("thematic_maps").select("*").eq("notebook_id", notebookId).eq("version", version).maybeSingle();
    fail(error, "Falha ao carregar a versão do mapa");
    return data ? toVersion(data as Row) : null;
  }

  async list(notebookId: string): Promise<MapVersionSummary[]> {
    const { data, error } = await this.supabase.from("thematic_maps").select("version, base_version, origin, status, created_at, confirmed_at").eq("notebook_id", notebookId).order("version", { ascending: false });
    fail(error, "Falha ao listar as versões do mapa");
    return ((data ?? []) as Pick<Row, "version" | "base_version" | "origin" | "status" | "created_at" | "confirmed_at">[]).map((row) => ({ version: row.version, baseVersion: row.base_version, origin: row.origin, status: row.status, createdAt: row.created_at, confirmedAt: row.confirmed_at }));
  }

  async confirm(notebookId: string, version: number) {
    const { data, error } = await this.supabase.rpc("confirm_thematic_map", { p_notebook_id: notebookId, p_version: version });
    if (error?.message.includes("map_not_found")) return null;
    fail(error, "Falha ao confirmar o mapa");
    return toVersion(data as Row);
  }
}
