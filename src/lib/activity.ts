import { supabaseStore, type ActivityStore } from "./activity-store";
import type { LogEntry, RunKind, RunStats, RunStatus, RunTrigger } from "./activity-types";

/**
 * Activity log, automation runs and scan records.
 *
 * Two rules:
 *  1. Recording never breaks the work being recorded: every function here swallows storage errors.
 *  2. A failed write is never silent: it is written to the process log with the full entry so it can be recovered
 *     from the hosting provider's logs (Vercel / GitHub Actions) and is counted in `writeFailures`.
 */
export const writeFailures = { count: 0 };

let defaultStore: ActivityStore | null = null;
const store = (s?: ActivityStore) => s ?? (defaultStore ??= supabaseStore());

function lost(what: string, payload: unknown, err: unknown) {
  writeFailures.count++;
  console.error(`[activity] could not record ${what}: ${err instanceof Error ? err.message : String(err)} :: ${JSON.stringify(payload).slice(0, 2000)}`);
}

const row = (e: LogEntry) => ({
  level: e.level ?? "info", kind: e.kind, message: e.message.slice(0, 2000),
  run_id: e.run_id ?? null, scan_id: e.scan_id ?? null, integration: e.integration ?? null, portal: e.portal ?? null,
  country: e.country ?? null, company: e.company ?? null, job_id: e.job_id ?? null, application_id: e.application_id ?? null,
  status: e.status ?? null, detail: e.detail ?? {},
});

export async function logActivity(e: LogEntry, s?: ActivityStore): Promise<boolean> {
  try { await store(s).insert("activity_log", row(e)); return true; } catch (err) { lost("activity", e, err); return false; }
}

export async function logMany(entries: LogEntry[], s?: ActivityStore): Promise<boolean> {
  if (entries.length === 0) return true;
  try { await store(s).insertMany("activity_log", entries.map(row)); return true; } catch (err) { lost(`${entries.length} activities`, entries, err); return false; }
}

// ------------------------------------------------------------------ runs

export type RunOpts = { trigger: RunTrigger; kind: RunKind; schedule_id?: string | null; scope?: Record<string, unknown> };

export async function startRun(o: RunOpts, s?: ActivityStore): Promise<string | null> {
  try {
    const r = await store(s).insert("automation_runs", { trigger: o.trigger, kind: o.kind, schedule_id: o.schedule_id ?? null, scope: o.scope ?? {}, status: "running" });
    return r ? String(r.id) : null;
  } catch (err) { lost("run start", o, err); return null; }
}

export async function heartbeat(runId: string | null, s?: ActivityStore) {
  if (!runId) return;
  try { await store(s).update("automation_runs", runId, { heartbeat_at: new Date().toISOString() }); } catch (err) { lost("heartbeat", { runId }, err); }
}

export async function finishRun(runId: string | null, f: { status: Exclude<RunStatus, "running">; stats?: RunStats; error?: string }, s?: ActivityStore) {
  if (!runId) return;
  try {
    await store(s).update("automation_runs", runId, { status: f.status, finished_at: new Date().toISOString(), stats: f.stats ?? {}, error: f.error?.slice(0, 2000) ?? null });
  } catch (err) { lost("run finish", { runId, ...f }, err); }
}

export type RunCtx = {
  id: string | null;
  /** Add to a numeric counter shown on the run (e.g. "discovered", "matched"). */
  stat: (key: string, n?: number) => void;
  /** Log an entry attached to this run. */
  log: (e: LogEntry) => Promise<boolean>;
  /** Mark the run as partially successful (some sources failed, others worked). */
  markPartial: (reason: string) => void;
  stats: RunStats;
};

/**
 * Run `fn` inside a recorded automation run. The run is created before `fn` starts and is ALWAYS finalised:
 * succeeded, partial (markPartial was called) or failed (fn threw; the error is stored and rethrown).
 */
export async function withRun<T>(o: RunOpts, fn: (ctx: RunCtx) => Promise<T>, s?: ActivityStore): Promise<T> {
  const id = await startRun(o, s);
  const stats: RunStats = {};
  const partial: string[] = [];
  const ctx: RunCtx = {
    id, stats,
    stat: (k, n = 1) => { stats[k] = (stats[k] ?? 0) + n; },
    log: (e) => logActivity({ ...e, run_id: id }, s),
    markPartial: (reason) => { partial.push(reason); },
  };
  await logActivity({ kind: "run.started", message: `${o.kind} run started (${o.trigger})`, run_id: id, detail: { scope: o.scope ?? {} } }, s);
  try {
    const out = await fn(ctx);
    const status = partial.length ? "partial" : "succeeded";
    await finishRun(id, { status, stats, error: partial.length ? partial.join("; ") : undefined }, s);
    await logActivity({ kind: "run.finished", level: partial.length ? "warn" : "info", message: `${o.kind} run ${status}`, run_id: id, status, detail: { stats, partial } }, s);
    return out;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finishRun(id, { status: "failed", stats, error }, s);
    await logActivity({ kind: "run.failed", level: "error", message: `${o.kind} run failed: ${error}`, run_id: id, status: "failed", detail: { stats } }, s);
    throw e;
  }
}

/** Watchdog: any run still "running" with no heartbeat for `maxAgeMinutes` died without finishing; mark it failed. */
export async function failStaleRuns(maxAgeMinutes = 30, s?: ActivityStore): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    const stale = await store(s).selectWhere("automation_runs", { column: "heartbeat_at", op: "lt", value: cutoff }, 50);
    const running = stale.filter((r) => r.status === "running");
    for (const r of running) {
      await finishRun(String(r.id), { status: "failed", error: `No progress for ${maxAgeMinutes} minutes; the run stopped unexpectedly` }, s);
      await logActivity({ kind: "run.failed", level: "error", message: `Run ${String(r.id).slice(0, 8)} stopped unexpectedly (no heartbeat for ${maxAgeMinutes} minutes)`, run_id: String(r.id), status: "failed" }, s);
    }
    return running.length;
  } catch (err) { lost("stale-run sweep", {}, err); return 0; }
}

// ------------------------------------------------------------------ scans

export type ScanOpts = { run_id?: string | null; integration: string; portal?: string | null; country?: string | null; query?: string | null };
export type ScanResult = { status: "ok" | "error"; fetched?: number; inserted?: number; duplicates?: number; stale?: number; invalid?: number; error?: string; detail?: Record<string, unknown> };

export async function startScan(o: ScanOpts, s?: ActivityStore): Promise<string | null> {
  try {
    const r = await store(s).insert("portal_scans", { run_id: o.run_id ?? null, integration: o.integration, portal: o.portal ?? null, country: o.country ?? null, query: o.query ?? null, status: "running" });
    return r ? String(r.id) : null;
  } catch (err) { lost("scan start", o, err); return null; }
}

export async function finishScan(scanId: string | null, o: ScanOpts, r: ScanResult, s?: ActivityStore) {
  if (scanId) {
    try {
      await store(s).update("portal_scans", scanId, {
        status: r.status, finished_at: new Date().toISOString(), fetched: r.fetched ?? 0, inserted: r.inserted ?? 0, duplicates: r.duplicates ?? 0,
        stale: r.stale ?? 0, invalid: r.invalid ?? 0, error: r.error?.slice(0, 2000) ?? null, detail: r.detail ?? {},
      });
    } catch (err) { lost("scan finish", { scanId, ...r }, err); }
  }
  await logActivity({
    kind: r.status === "ok" ? "scan.finished" : "scan.failed", level: r.status === "ok" ? "info" : "error",
    message: r.status === "ok" ? `${o.integration}${o.query ? ` "${o.query}"` : ""}${o.country ? ` (${o.country.toUpperCase()})` : ""}: ${r.fetched ?? 0} fetched, ${r.inserted ?? 0} new` : `${o.integration}${o.query ? ` "${o.query}"` : ""}: ${r.error}`,
    run_id: o.run_id ?? null, scan_id: scanId, integration: o.integration, portal: o.portal ?? null, country: o.country ?? null, status: r.status,
    detail: { fetched: r.fetched, inserted: r.inserted, duplicates: r.duplicates, stale: r.stale, invalid: r.invalid, ...(r.detail ?? {}) },
  }, s);
}
