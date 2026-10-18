import "server-only";
import { db, must } from "@/lib/db";
import { APP_STATUSES, JOB_VIEWS, type AppFilters, type JobFilters } from "@/lib/filters";
import { pageRange } from "@/lib/pagination";
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
 * One page of jobs for the list screens, filtered by view, portal, country and text and ordered best fit first across ALL pages.
 * It first reads only each match's id and score (a light query), orders them, takes the page, and then loads full rows for that page.
 * If the database update has not been applied yet (no portal column), the list still works without portal data and says so.
 */
export async function listJobs(f: JobFilters, paging: { page: number; size: number } = { page: 1, size: 25 }): Promise<{ rows: JobListRow[]; total: number; page: number; pages: number; shownFrom: number; shownTo: number; portalUnavailable: boolean }> {
  const filtered = <Q extends { in: Function; eq: Function; or: Function }>(q: Q, withPortal: boolean): Q => { // eslint-disable-line @typescript-eslint/no-unsafe-function-type
    let x = q;
    const statuses = JOB_VIEWS[f.view].statuses;
    if (statuses) x = x.in("status", statuses) as Q;
    if (withPortal && f.portal) x = x.eq("portal", f.portal) as Q;
    if (f.country) x = x.eq("country", f.country) as Q;
    if (f.q) x = x.or(`title.ilike.%${f.q}%,company.ilike.%${f.q}%`) as Q;
    return x;
  };
  const rank = async (withPortal: boolean) => filtered(db().from("jobs").select("id,found_at,job_scores(score)"), withPortal).order("found_at", { ascending: false }).limit(RANK_LIMIT);
  let portalUnavailable = false;
  let ranked = await rank(true);
  if (ranked.error && isMissingSchemaError(ranked.error.message)) { ranked = await rank(false); portalUnavailable = true; }
  const all = must<{ id: string; found_at: string; job_scores: { score: number } | { score: number }[] | null }[]>(ranked, "list jobs");
  const sc = (r: (typeof all)[number]) => (Array.isArray(r.job_scores) ? r.job_scores[0]?.score : r.job_scores?.score) ?? -1;
  all.sort((a, b) => sc(b) - sc(a) || b.found_at.localeCompare(a.found_at));
  const r = pageRange(all.length, paging.page, paging.size);
  const ids = all.slice(r.from, r.to + 1).map((x) => x.id);
  if (ids.length === 0) return { rows: [], total: all.length, page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable };
  const full = must<JobListRow[]>(await db().from("jobs").select(portalUnavailable ? JOB_COLS : `${JOB_COLS},portal`).in("id", ids), "list jobs");
  const order = new Map(ids.map((id, i) => [id, i]));
  return { rows: full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), total: all.length, page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable };
}

/** How many matches are ranked at most; beyond this the list says so. */
export const RANK_LIMIT = 5000;

export type AppListRow = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string;
  job: { title: string; company: string; country: string | null; apply_type: string; source: string | null; url?: string | null; portal?: string | null } | null;
  resume: { version: number } | null;
};

/** One page of applications with their job, newest first, filtered by status view, portal, country and text; tolerant of a pending migration. */
export async function listApplications(f: AppFilters, paging: { page: number; size: number } = { page: 1, size: 25 }): Promise<{ rows: AppListRow[]; total: number; page: number; pages: number; shownFrom: number; shownTo: number; portalUnavailable: boolean }> {
  const build = (withPortal: boolean, from: number, to: number) => {
    const jobCols = `title,company,country,apply_type,source,url${withPortal ? ",portal" : ""}`;
    let q = db().from("applications").select(`id,status,method,lifecycle,submitted_at,created_at, job:jobs!inner(${jobCols}), resume:documents!applications_resume_doc_id_fkey(version)`, { count: "exact" });
    const statuses = APP_STATUSES[f.status].statuses;
    if (statuses) q = q.in("status", statuses);
    if (withPortal && f.portal) q = q.eq("job.portal", f.portal);
    if (f.country) q = q.eq("job.country", f.country);
    if (f.q) q = q.or(`title.ilike.%${f.q}%,company.ilike.%${f.q}%`, { referencedTable: "job" });
    return q.order("created_at", { ascending: false }).range(from, to);
  };
  const from = (Math.max(1, paging.page) - 1) * paging.size;
  let res = await build(true, from, from + paging.size - 1);
  let portalUnavailable = false;
  if (res.error && isMissingSchemaError(res.error.message)) { res = await build(false, from, from + paging.size - 1); portalUnavailable = true; }
  // a page number past the end (rows were removed since the link was made) shows the last page instead of nothing
  const total = res.count ?? 0;
  const r = pageRange(total, paging.page, paging.size);
  if (r.page !== paging.page && total > 0) { res = await build(!portalUnavailable, r.from, r.to); }
  return { rows: must<AppListRow[]>(res, "list applications"), total, page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable };
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
