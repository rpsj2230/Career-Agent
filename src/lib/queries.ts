import "server-only";
import { db, must } from "@/lib/db";
import { APP_STATUSES, JOB_VIEWS, type AppFilters, type JobFilters } from "@/lib/filters";
import { isMissingSchemaError } from "@/lib/schema";

export type JobListRow = {
  id: string; title: string; company: string; country: string | null; location: string | null; url: string;
  apply_type: string; status: string; found_at: string; skip_reason: string | null;
  portal?: string | null; source?: string | null; salary_text?: string | null;
  job_scores: { score: number; detail: { summary: string } } | { score: number; detail: { summary: string } }[] | null;
};

export const scoreOf = (r: JobListRow) => (Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores);

const JOB_COLS = "id,title,company,country,location,url,apply_type,status,found_at,skip_reason,source,salary_text,job_scores(score,detail)";

/**
 * Jobs for the list screens, filtered by view, portal, country and text. If the database update has not been
 * applied yet (no portal column), the list still works without portal data and says so.
 */
export async function listJobs(f: JobFilters, limit = 300): Promise<{ rows: JobListRow[]; portalUnavailable: boolean }> {
  const build = (withPortal: boolean) => {
    let q = db().from("jobs").select(withPortal ? `${JOB_COLS},portal` : JOB_COLS);
    const statuses = JOB_VIEWS[f.view].statuses;
    if (statuses) q = q.in("status", statuses);
    if (withPortal && f.portal) q = q.eq("portal", f.portal);
    if (f.country) q = q.eq("country", f.country);
    if (f.q) q = q.or(`title.ilike.%${f.q}%,company.ilike.%${f.q}%`);
    return q.order("found_at", { ascending: false }).limit(limit);
  };
  let res = await build(true);
  let portalUnavailable = false;
  if (res.error && isMissingSchemaError(res.error.message)) { res = await build(false); portalUnavailable = true; }
  const rows = must<JobListRow[]>(res, "list jobs");
  return { rows: rows.sort((a, b) => (scoreOf(b)?.score ?? -1) - (scoreOf(a)?.score ?? -1)), portalUnavailable };
}

export type AppListRow = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string;
  job: { title: string; company: string; country: string | null; apply_type: string; source: string | null; portal?: string | null } | null;
  resume: { version: number } | null;
};

/** Applications with their job, filtered by status view, portal, country and text; tolerant of a pending migration. */
export async function listApplications(f: AppFilters, limit = 300): Promise<{ rows: AppListRow[]; portalUnavailable: boolean }> {
  const build = (withPortal: boolean) => {
    const jobCols = `title,company,country,apply_type,source${withPortal ? ",portal" : ""}`;
    let q = db().from("applications").select(`id,status,method,lifecycle,submitted_at,created_at, job:jobs!inner(${jobCols}), resume:documents!applications_resume_doc_id_fkey(version)`);
    const statuses = APP_STATUSES[f.status].statuses;
    if (statuses) q = q.in("status", statuses);
    if (withPortal && f.portal) q = q.eq("job.portal", f.portal);
    if (f.country) q = q.eq("job.country", f.country);
    if (f.q) q = q.or(`title.ilike.%${f.q}%,company.ilike.%${f.q}%`, { referencedTable: "job" });
    return q.order("created_at", { ascending: false }).limit(limit);
  };
  let res = await build(true);
  let portalUnavailable = false;
  if (res.error && isMissingSchemaError(res.error.message)) { res = await build(false); portalUnavailable = true; }
  return { rows: must<AppListRow[]>(res, "list applications"), portalUnavailable };
}

/** Distinct portals and countries that exist in the data, for the filter drop-downs. */
export async function filterOptions(): Promise<{ portals: { key: string; n: number }[]; countries: { key: string; n: number }[] }> {
  const tally = (rows: { [k: string]: string | null }[], col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r[col]; if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  };
  let res = await db().from("jobs").select("portal,country").limit(20000);
  if (res.error) res = await db().from("jobs").select("country").limit(20000) as unknown as typeof res;
  const rows = (res.data ?? []) as { [k: string]: string | null }[];
  return { portals: tally(rows, "portal"), countries: tally(rows, "country") };
}

export async function counts(country?: string) {
  const c = async (status: string) => {
    let q = db().from("jobs").select("id", { count: "exact", head: true }).eq("status", status);
    if (country) q = q.eq("country", country);
    return (await q).count ?? 0;
  };
  const appCount = async (apply: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = db().from("applications").select(country ? "id, job:jobs!inner(country)" : "id", { count: "exact", head: true });
    if (country) q = q.eq("job.country", country);
    return ((await apply(q)).count as number | null) ?? 0;
  };
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [fresh, queued, prepared, applied, saved] = await Promise.all([c("new"), c("queued"), c("prepared"), c("applied"), c("saved")]);
  const sent7 = await appCount((q) => q.eq("status", "submitted").gte("submitted_at", weekAgo));
  const failed = await appCount((q) => q.in("status", ["failed", "needs_input"]));
  return { fresh, queued, prepared, applied, saved, sent7, failed };
}

import type { ReportRow } from "@/lib/reports";

export async function reportRows(country?: string): Promise<ReportRow[]> {
  let q = db().from("applications").select(`status,lifecycle,submitted_at, job:jobs${country ? "!inner" : ""}(country,source,apply_type,job_scores(score,detail))`).limit(2000);
  if (country) q = q.eq("job.country", country);
  const rows = must<{ status: string; lifecycle: string; submitted_at: string | null; job: { country: string | null; source: string; apply_type: string; job_scores: { score: number; detail: { gaps?: string[] } } | { score: number; detail: { gaps?: string[] } }[] | null } | null }[]>(
    await q,
    "report rows",
  );
  return rows.map((r) => {
    const sc = Array.isArray(r.job?.job_scores) ? r.job?.job_scores[0] : r.job?.job_scores;
    return {
      country: r.job?.country ?? null, source: r.job?.source ?? "unknown", apply_type: r.job?.apply_type ?? "unknown", status: r.status,
      lifecycle: r.lifecycle, submitted_at: r.submitted_at, score: sc?.score ?? null, gaps: sc?.detail?.gaps ?? [],
    };
  });
}

/** Start of a trailing window; kept outside components so render stays pure. */
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
