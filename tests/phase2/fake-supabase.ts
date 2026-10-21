import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

export class FakeDb {
  tables: Record<string, Row[]> = { documents: [], notebooks: [], notebook_sources: [], jobs: [], job_stages: [], stage_cache: [] };
  clock = () => Date.now();
}

const DEFAULTS: Record<string, () => Row> = {
  jobs: () => ({ kind: "build_notebook", status: "queued", error: null, finished_at: null }),
  job_stages: () => ({ status: "pending", attempts: 0, max_attempts: 3, lease_expires_at: null, input_hash: null, output: null, cache_hit: false, error: null, started_at: null, finished_at: null, duration_ms: null, tokens_in: 0, tokens_out: 0, cost_usd: 0 }),
};

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] = {};
  private filters: Array<(row: Row) => boolean> = [];
  private ordering: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  constructor(private readonly db: FakeDb, private readonly userId: string, private readonly table: string) {}

  select() { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }
  insert(payload: Row | Row[]) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(payload: Row, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = payload; this.upsertOptions = options; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(column: string, options: { ascending?: boolean } = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  limit(count: number) { this.max = count; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private rows() { return this.db.tables[this.table].filter((row) => (row.owner_id === undefined || row.owner_id === this.userId) && this.filters.every((filter) => filter(row))); }

  private finish(rows: Row[]): Result {
    let out = rows.map((row) => ({ ...row }));
    if (this.ordering) { const { column, ascending } = this.ordering; out = out.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1)); }
    if (this.max !== null) out = out.slice(0, this.max);
    if (this.mode === "single") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "linha única esperada" } };
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  private execute(): Result {
    const table = this.db.tables[this.table];
    if (this.op === "select") return this.finish(this.rows());
    if (this.op === "update") { const rows = this.rows(); rows.forEach((row) => Object.assign(row, this.payload)); return this.returning ? this.finish(rows) : { data: null, error: null }; }
    if (this.op === "delete") { const doomed = new Set(this.rows()); this.db.tables[this.table] = table.filter((row) => !doomed.has(row)); return { data: null, error: null }; }
    if (this.op === "upsert") {
      const row: Row = { owner_id: this.userId, ...(this.payload as Row) };
      const keys = (this.upsertOptions.onConflict ?? "").split(",").filter(Boolean);
      const exists = table.some((candidate) => keys.every((key) => candidate[key] === row[key]));
      if (!exists) table.push(row);
      return { data: null, error: null };
    }
    const now = new Date(this.db.clock()).toISOString();
    const inserted: Row[] = [];
    for (const payload of Array.isArray(this.payload) ? this.payload : [this.payload]) {
      const row: Row = { id: randomUUID(), owner_id: this.userId, created_at: now, updated_at: now, next_attempt_at: now, ...(DEFAULTS[this.table]?.() ?? {}), ...payload };
      if (this.table === "jobs" && table.some((job) => job.notebook_id === row.notebook_id && job.input_hash === row.input_hash && ["queued", "running", "succeeded"].includes(job.status as string))) return { data: null, error: { message: "duplicate key", code: "23505" } };
      table.push(row);
      inserted.push(row);
    }
    return this.finish(inserted);
  }

  then<R1 = Result, R2 = never>(onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }
}

export function makeFakeSupabase(db: FakeDb, userId: string) {
  return {
    from: (table: string) => new Query(db, userId, table),
    // Mesma semântica da função SQL public.claim_next_stage.
    rpc: async (name: string, args: { p_job_id: string; p_lease_seconds: number }) => {
      if (name !== "claim_next_stage") return { data: null, error: { message: `rpc desconhecida: ${name}` } };
      const now = db.clock();
      const candidate = db.tables.job_stages.filter((s) => s.owner_id === userId && s.job_id === args.p_job_id && !["succeeded", "skipped"].includes(s.status as string)).sort((a, b) => (a.position as number) - (b.position as number))[0];
      if (!candidate) return { data: [], error: null };
      const lease = candidate.lease_expires_at ? Date.parse(candidate.lease_expires_at as string) : null;
      const expired = candidate.status === "running" && lease !== null && lease < now;
      if (expired && (candidate.attempts as number) >= (candidate.max_attempts as number)) { Object.assign(candidate, { status: "failed", error: "A etapa foi interrompida e esgotou as tentativas.", lease_expires_at: null }); return { data: [], error: null }; }
      if ((candidate.status === "pending" && Date.parse(candidate.next_attempt_at as string) <= now) || expired) {
        Object.assign(candidate, { status: "running", attempts: (candidate.attempts as number) + 1, started_at: candidate.started_at ?? new Date(now).toISOString(), lease_expires_at: new Date(now + args.p_lease_seconds * 1000).toISOString() });
        return { data: [{ ...candidate }], error: null };
      }
      return { data: [], error: null };
    },
  };
}
