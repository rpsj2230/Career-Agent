import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { localDayBounds } from "@/lib/time";
import { type LogFilters } from "./log-filters";

export type LogRow = {
  id: number; at: string; level: "info" | "warn" | "error"; kind: string; run_id: string | null; scan_id: string | null;
  integration: string | null; portal: string | null; country: string | null; company: string | null;
  job_id: string | null; application_id: string | null; status: string | null; message: string; detail: Record<string, unknown>;
};

/** Apply the filters to an activity_log query. Dates are calendar days in the display time zone. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLogFilters<Q extends { eq: any; gte: any; lte: any; like: any; ilike: any }>(q: Q, f: LogFilters, tz?: string): Q {
  let x: any = q; // eslint-disable-line @typescript-eslint/no-explicit-any
  const from = f.from ? localDayBounds(f.from, tz) : null;
  const to = f.to ? localDayBounds(f.to, tz) : null;
  if (from) x = x.gte("at", from.from);
  if (to) x = x.lte("at", to.to);
  if (f.level) x = x.eq("level", f.level);
  if (f.category) x = x.like("kind", `${f.category}.%`);
  if (f.kind) x = x.eq("kind", f.kind);
  if (f.portal) x = x.eq("portal", f.portal);
  if (f.country) x = x.eq("country", f.country);
  if (f.company) x = x.ilike("company", `%${f.company}%`);
  if (f.status) x = x.eq("status", f.status);
  if (f.run) x = x.eq("run_id", f.run);
  if (f.app) x = x.eq("application_id", f.app);
  if (f.job) x = x.eq("job_id", f.job);
  if (f.q) x = x.ilike("message", `%${f.q}%`);
  return x as Q;
}

export async function queryLogs(f: LogFilters, tz?: string): Promise<{ rows: LogRow[]; total: number; missing: boolean }> {
  const start = (f.page - 1) * f.size;
  const base = db().from("activity_log").select("*", { count: "exact" });
  const res = await applyLogFilters(base, f, tz).order("at", { ascending: f.order === "oldest" }).order("id", { ascending: f.order === "oldest" }).range(start, start + f.size - 1);
  if (res.error) {
    if (isMissingSchemaError(res.error.message)) return { rows: [], total: 0, missing: true };
    throw new Error(`load logs: ${res.error.message}`);
  }
  return { rows: res.data as LogRow[], total: res.count ?? (res.data?.length ?? 0), missing: false };
}

export type RunRow = {
  id: string; schedule_id: string | null; trigger: string; kind: string; status: string; started_at: string; finished_at: string | null;
  heartbeat_at: string; scope: Record<string, unknown>; stats: Record<string, number>; error: string | null;
};
export type ScanRow2 = {
  id: string; run_id: string | null; integration: string; portal: string | null; country: string | null; query: string | null; status: string;
  started_at: string; finished_at: string | null; fetched: number; inserted: number; duplicates: number; stale: number; invalid: number; error: string | null; detail: Record<string, unknown> | null;
};

export async function listRuns(o: { status?: string; kind?: string; from?: string; to?: string; tz?: string; limit?: number; page?: number }): Promise<{ rows: RunRow[]; missing: boolean; total: number }> {
  let q = db().from("automation_runs").select("*", { count: "exact" });
  if (o.status) q = q.eq("status", o.status);
  if (o.kind) q = q.eq("kind", o.kind);
  const from = o.from ? localDayBounds(o.from, o.tz) : null, to = o.to ? localDayBounds(o.to, o.tz) : null;
  if (from) q = q.gte("started_at", from.from);
  if (to) q = q.lte("started_at", to.to);
  const size = o.limit ?? 100, start = (Math.max(1, o.page ?? 1) - 1) * size;
  const res = await q.order("started_at", { ascending: false }).range(start, start + size - 1);
  if (res.error) { if (isMissingSchemaError(res.error.message)) return { rows: [], missing: true, total: 0 }; throw new Error(`load runs: ${res.error.message}`); }
  return { rows: res.data as RunRow[], missing: false, total: res.count ?? (res.data as RunRow[]).length };
}

export async function getRun(id: string): Promise<{ run: RunRow | null; scans: ScanRow2[] }> {
  const run = (await db().from("automation_runs").select("*").eq("id", id).maybeSingle()).data as RunRow | null;
  const scans = (await db().from("portal_scans").select("*").eq("run_id", id).order("started_at", { ascending: true })).data as ScanRow2[] | null;
  return { run, scans: scans ?? [] };
}

export async function recentScans(o: { from?: string; to?: string; tz?: string; limit?: number }): Promise<ScanRow2[]> {
  let q = db().from("portal_scans").select("*");
  const from = o.from ? localDayBounds(o.from, o.tz) : null, to = o.to ? localDayBounds(o.to, o.tz) : null;
  if (from) q = q.gte("started_at", from.from);
  if (to) q = q.lte("started_at", to.to);
  const res = await q.order("started_at", { ascending: false }).limit(o.limit ?? 500);
  return res.error ? [] : (res.data as ScanRow2[]);
}

/** Application log lines in a period (or one run), for the "how applying went" report. */
export async function applyLogs(o: { from?: string; to?: string; tz?: string; run?: string }) {
  const from = o.from ? localDayBounds(o.from, o.tz) : null, to = o.to ? localDayBounds(o.to, o.tz) : null;
  const res = await fetchAll((a, b) => {
    let q = db().from("activity_log").select("kind,portal,country,status,detail").in("kind", ["application.submitted", "application.approved", "application.needs_input", "application.manual", "application.failed"]);
    if (o.run) q = q.eq("run_id", o.run);
    if (from) q = q.gte("at", from.from);
    if (to) q = q.lte("at", to.to);
    return q.order("at", { ascending: false }).order("id").range(a, b);
  }, 20_000);
  return res.error ? [] : (res.data as { kind: string; portal: string | null; country: string | null; status: string | null; detail: Record<string, unknown> | null }[]);
}
