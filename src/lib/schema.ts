import { createClient } from "@supabase/supabase-js";

/** Every table/column the app reads, and the migration that introduces it. Keep in sync with supabase/migrations. */
export const REQUIRED_SCHEMA: { table: string; migration: string; columns: string[] }[] = [
  { table: "profile", migration: "0001_init", columns: ["id", "data"] },
  { table: "settings", migration: "0001_init", columns: ["key", "value"] },
  { table: "answer_bank", migration: "0001_init", columns: ["key", "question", "answer"] },
  { table: "jobs", migration: "0001_init", columns: ["id", "source", "title", "company", "country", "url", "description", "status"] },
  { table: "job_scores", migration: "0001_init", columns: ["job_id", "score", "detail"] },
  { table: "documents", migration: "0001_init", columns: ["id", "job_id", "kind", "version", "content", "storage_path"] },
  { table: "applications", migration: "0001_init", columns: ["id", "job_id", "status", "answers"] },
  { table: "apply_events", migration: "0001_init", columns: ["id", "application_id", "kind"] },
  { table: "model_configs", migration: "0001_init", columns: ["id", "label", "base_url", "model"] },
  { table: "model_usage", migration: "0001_init", columns: ["id", "model_label", "ok"] },
  { table: "integrations", migration: "0002_portals_runs_logs_schedules", columns: ["id", "enabled", "status", "last_scan_at", "last_error", "jobs_found_total"] },
  { table: "schedules", migration: "0002_portals_runs_logs_schedules", columns: ["id", "name", "enabled", "paused", "frequency", "time_of_day", "timezone", "mode", "require_approval", "next_run_at"] },
  { table: "automation_runs", migration: "0002_portals_runs_logs_schedules", columns: ["id", "trigger", "kind", "status", "started_at", "finished_at", "stats", "error"] },
  { table: "portal_scans", migration: "0002_portals_runs_logs_schedules", columns: ["id", "integration", "status", "fetched", "inserted", "error"] },
  { table: "activity_log", migration: "0002_portals_runs_logs_schedules", columns: ["id", "at", "level", "kind", "portal", "country", "company", "message", "detail"] },
  { table: "country_prefs", migration: "0002_portals_runs_logs_schedules", columns: ["country", "enabled", "titles", "currency"] },
  { table: "daily_reports", migration: "0002_portals_runs_logs_schedules", columns: ["id", "report_date", "summary", "items"] },
  { table: "jobs", migration: "0002_portals_runs_logs_schedules", columns: ["portal", "scan_id", "run_id", "salary_min", "salary_max", "salary_currency", "salary_estimated", "decided_at"] },
  { table: "applications", migration: "0002_portals_runs_logs_schedules", columns: ["job_snapshot", "profile_snapshot", "submission", "run_id", "portal", "country"] },
];

export type SchemaProblem = { table: string; column?: string; migration: string; kind: "table" | "column" };
export type SchemaStatus = {
  ok: boolean;
  unreachable?: string;
  problems: SchemaProblem[];
  pendingMigrations: string[];
  checkedAt: string;
};

/** Classifies a PostgREST/Postgres error as "the table is missing", "a column is missing" or something else. */
export function classifySchemaError(err: { code?: string; message?: string } | null): "table" | "column" | "other" | null {
  if (!err) return null;
  const msg = err.message ?? "";
  if (err.code === "42P01" || err.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(msg)) return "table";
  if (err.code === "42703" || err.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(msg)) return "column";
  return "other";
}

/** Pure: turn probe results into a status (separated so it can be tested without a database). */
export function buildStatus(problems: SchemaProblem[], checkedAt = new Date().toISOString(), unreachable?: string): SchemaStatus {
  return {
    ok: problems.length === 0 && !unreachable,
    unreachable,
    problems,
    pendingMigrations: [...new Set(problems.map((p) => p.migration))].sort(),
    checkedAt,
  };
}

let cache: { at: number; status: SchemaStatus } | null = null;
// Only a HEALTHY result is cached (Next.js keeps route handlers and pages in separate module instances, so a cache
// cleared in one is not cleared in the other). A broken database is re-checked on every request and a fix is seen at once.
const TTL_OK_MS = 60_000;

/** Probes every required column with a zero-row select. Cached for a minute unless `fresh`. */
export async function checkSchema(fresh = false): Promise<SchemaStatus> {
  if (!fresh && cache && cache.status.ok && Date.now() - cache.at < TTL_OK_MS) return cache.status;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return buildStatus([], new Date().toISOString(), "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const problems: SchemaProblem[] = [];
  let unreachable: string | undefined;
  await Promise.all(REQUIRED_SCHEMA.flatMap((req) => req.columns.map(async (column) => {
    try {
      const { error } = await sb.from(req.table).select(column).limit(0);
      const kind = classifySchemaError(error);
      if (kind === "table" || kind === "column") problems.push({ table: req.table, column: kind === "column" ? column : undefined, migration: req.migration, kind });
      else if (kind === "other" && !unreachable) unreachable = error?.message;
    } catch (e) {
      unreachable ??= e instanceof Error ? e.message : String(e);
    }
  })));

  // one entry per missing table (not one per column of that table)
  const seen = new Set<string>();
  const deduped = problems.filter((p) => {
    const k = p.kind === "table" ? `t:${p.table}` : `c:${p.table}.${p.column}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (a.table + (a.column ?? "")).localeCompare(b.table + (b.column ?? "")));
  const status = buildStatus(deduped, new Date().toISOString(), unreachable);
  cache = status.ok ? { at: Date.now(), status } : null;
  return status;
}

/** For pages that read new tables: true when an error just means "migration not applied yet". */
export const isMissingSchemaError = (message: string | undefined | null) =>
  !!message && classifySchemaError({ message }) !== "other" && classifySchemaError({ message }) !== null;

/**
 * Run `primary`; if it fails only because the database has not been migrated yet (missing table/column), run
 * `fallback` (the same operation without the new fields) so features keep working while System asks for the update.
 */
export async function withLegacyFallback<T extends { error: { message: string } | null }>(primary: () => PromiseLike<T>, fallback: () => PromiseLike<T>): Promise<T> {
  const r = await primary();
  return r.error && isMissingSchemaError(r.error.message) ? fallback() : r;
}
