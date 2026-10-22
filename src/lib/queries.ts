import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import { db, must } from "@/lib/db";
import { pageRange } from "@/lib/pagination";
import {
  appStage, appStageCounts, filterApps, filterAppsExceptStage, filterJobs, filterJobsExceptStage, jobStage, sortApps, sortJobs, stageCounts,
  type AppLight, type AppQuery, type JobLight, type JobQuery, type StageKey,
} from "@/lib/list-query";
import { isMissingSchemaError } from "@/lib/schema";

export type JobListRow = {
  id: string; title: string; company: string; country: string | null; location: string | null; url: string;
  apply_type: string; status: string; found_at: string; skip_reason: string | null;
  portal?: string | null; source?: string | null; salary_text?: string | null;
  job_scores: { score: number; detail: { summary: string } } | { score: number; detail: { summary: string } }[] | null;
};

export const scoreOf = (r: JobListRow) => (Array.isArray(r.job_scores) ? r.job_scores[0] : r.job_scores);

const JOB_COLS = "id,title,company,country,location,url,apply_type,status,found_at,skip_reason,source,salary_text,job_scores(score,detail)";

/** The most jobs read for one list (every page of 1000 is fetched until then). */
export const RANK_LIMIT = 50_000;

export type AppListRow = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string; approved_at?: string | null; error?: string | null;
  job: { title: string; company: string; country: string | null; apply_type: string; source: string | null; url?: string | null; portal?: string | null } | null;
  resume: { version: number } | null;
};

/** Distinct portals and countries that exist in the data, for the filter drop-downs. */
export async function filterOptions(): Promise<{ portals: { key: string; n: number }[]; vias: { key: string; n: number }[]; countries: { key: string; n: number }[] }> {
  const tally = (rows: { [k: string]: string | null }[], col: string) => {
    const m = new Map<string, number>();
    for (const r of rows) { const k = r[col]; if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  };
  let res = await fetchAll<{ [k: string]: string | null }>((a, b) => db().from("jobs").select("portal,country,source").order("id").range(a, b), 100_000);
  if (res.error) res = await fetchAll<{ [k: string]: string | null }>((a, b) => db().from("jobs").select("country,source").order("id").range(a, b), 100_000);
  const rows = res.data;
  const withVia = rows.map((r) => ({ ...r, via: r.source ? r.source.split(":")[0] : null }));
  return { portals: tally(rows, "portal"), vias: tally(withVia, "via"), countries: tally(rows, "country") };
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
  const [fresh, queued, prepared, applied, saved, sent7, failed] = await Promise.all([
    c("new"), c("queued"), c("prepared"), c("applied"), c("saved"),
    appCount((q) => q.eq("status", "submitted").gte("submitted_at", weekAgo)),
    appCount((q) => q.in("status", ["failed", "needs_input"])),
  ]);
  return { fresh, queued, prepared, applied, saved, sent7, failed };
}

import type { ReportRow } from "@/lib/reports";

export async function reportRows(country?: string): Promise<ReportRow[]> {
  const page = (a: number, b: number) => {
    const q = db().from("applications").select(`status,lifecycle,submitted_at, job:jobs${country ? "!inner" : ""}(country,source,apply_type,job_scores(score,detail))`);
    return (country ? q.eq("job.country", country) : q).order("id").range(a, b);
  };
  const rows = must<{ status: string; lifecycle: string; submitted_at: string | null; job: { country: string | null; source: string; apply_type: string; job_scores: { score: number; detail: { gaps?: string[] } } | { score: number; detail: { gaps?: string[] } }[] | null } | null }[]>(
    await fetchAll(page),
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

/** The application (if any) for each of these jobs, so the list can link to the resume and offer Apply. */
export async function applicationsForJobs(jobIds: string[]): Promise<Map<string, { id: string; status: string }>> {
  const out = new Map<string, { id: string; status: string }>();
  if (jobIds.length === 0) return out;
  const rows = must<{ id: string; job_id: string; status: string }[]>(await db().from("applications").select("id,job_id,status").in("job_id", jobIds), "load applications for jobs");
  for (const r of rows) out.set(r.job_id, { id: r.id, status: r.status });
  return out;
}


// ---------------------------------------------------------------------------------------------------------------
// Lists with full filtering and sorting. The matching rows are read in light form (a handful of columns, all pages), then
// filtered, counted per stage, sorted and cut into pages in memory (src/lib/list-query.ts), and only the visible page is loaded in full.

type RawJob = {
  id: string; title: string; company: string; country: string | null; location: string | null; status: string; found_at: string; posted_at: string | null;
  apply_type: string; url: string; source?: string | null; portal?: string | null;
  job_scores: { score: number } | { score: number }[] | null;
  application: { status: string } | { status: string }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export type JobsPage = {
  rows: JobListRow[]; total: number; totalAll: number; page: number; pages: number; shownFrom: number; shownTo: number; portalUnavailable: boolean;
  stageCounts: Record<StageKey, number>; stageOf: Map<string, StageKey>;
};

/** Every row of a table, ignoring filters, so "filtered from N" tells the truth even when the database already narrowed the fetch. */
async function tableTotal(table: "jobs" | "applications", floor: number): Promise<number> {
  try {
    const { count } = await db().from(table).select("id", { count: "exact", head: true });
    return Math.max(count ?? 0, floor);
  } catch {
    return floor;
  }
}

export async function listJobsFiltered(q: JobQuery, paging: { page: number; size: number } = { page: 1, size: 25 }): Promise<JobsPage> {
  const load = async (withPortal: boolean) => fetchAll<RawJob>((a, b) => {
    let x = db().from("jobs").select(`id,title,company,country,location,status,found_at,posted_at,apply_type,url,source${withPortal ? ",portal" : ""},job_scores(score),application:applications(status)`);
    if (q.countries.length) x = x.in("country", q.countries);
    if (withPortal && q.portals.length) x = x.in("portal", q.portals);
    if (q.from) x = x.gte("found_at", `${q.from}T00:00:00Z`);
    if (q.to) x = x.lte("found_at", `${q.to}T23:59:59.999Z`);
    return x.order("id").range(a, b);
  }, RANK_LIMIT);
  let portalUnavailable = false;
  let res = await load(true);
  if (res.error && isMissingSchemaError(res.error.message)) { res = await load(false); portalUnavailable = true; }
  if (res.error) throw new Error(`list jobs: ${res.error.message}`);
  const light: JobLight[] = res.data.map((r) => ({
    id: r.id, title: r.title, company: r.company, country: r.country, location: r.location, status: r.status, found_at: r.found_at, posted_at: r.posted_at,
    portal: r.portal ?? null, source: r.source ?? null, apply_type: r.apply_type, url: r.url, score: one(r.job_scores)?.score ?? null, appStatus: one(r.application)?.status ?? null,
  }));
  const otherFilters = filterJobsExceptStage(light, q);
  const counts = stageCounts(otherFilters);
  const matching = sortJobs(filterJobs(light, q), q.sort, q.dir);
  const r = pageRange(matching.length, paging.page, paging.size);
  const ids = matching.slice(r.from, r.to + 1).map((x) => x.id);
  const stageOf = new Map(matching.slice(r.from, r.to + 1).map((x) => [x.id, jobStage(x.status, x.appStatus)] as const));
  if (ids.length === 0) return { rows: [], total: matching.length, totalAll: await tableTotal("jobs", light.length), page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable, stageCounts: counts, stageOf };
  const full = must<JobListRow[]>(await db().from("jobs").select(portalUnavailable ? JOB_COLS : `${JOB_COLS},portal`).in("id", ids), "list jobs");
  const order = new Map(ids.map((id, i) => [id, i]));
  return { rows: full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), total: matching.length, totalAll: await tableTotal("jobs", light.length), page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable, stageCounts: counts, stageOf };
}

type RawApp = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string;
  job: RawAppJob | RawAppJob[] | null;
};
type RawAppJob = { title: string; company: string; country: string | null; apply_type: string; url: string; portal?: string | null; job_scores?: { score: number } | { score: number }[] | null };
export type AppsPage = { rows: AppListRow[]; total: number; totalAll: number; page: number; pages: number; shownFrom: number; shownTo: number; portalUnavailable: boolean; stageCounts: Record<StageKey, number> };

async function loadAppsLight(q: AppQuery): Promise<{ light: AppLight[]; portalUnavailable: boolean }> {
  const load = async (withPortal: boolean) => fetchAll<RawApp>((a, b) => {
    let x = db().from("applications").select(`id,status,method,lifecycle,submitted_at,created_at, job:jobs!inner(title,company,country,apply_type,url${withPortal ? ",portal" : ""},job_scores(score))`);
    if (q.lifecycles.length) x = x.in("lifecycle", q.lifecycles);
    if (q.from) x = x.gte("created_at", `${q.from}T00:00:00Z`);
    if (q.to) x = x.lte("created_at", `${q.to}T23:59:59.999Z`);
    if (q.sentFrom) x = x.gte("submitted_at", `${q.sentFrom}T00:00:00Z`);
    if (q.sentTo) x = x.lte("submitted_at", `${q.sentTo}T23:59:59.999Z`);
    return x.order("id").range(a, b);
  }, RANK_LIMIT);
  let portalUnavailable = false;
  let res = await load(true);
  if (res.error && isMissingSchemaError(res.error.message)) { res = await load(false); portalUnavailable = true; }
  if (res.error) throw new Error(`list applications: ${res.error.message}`);
  const light: AppLight[] = res.data.flatMap((r) => {
    const j = one(r.job);
    return j ? [{ id: r.id, status: r.status, method: r.method, lifecycle: r.lifecycle, submitted_at: r.submitted_at, created_at: r.created_at, title: j.title, company: j.company, country: j.country, portal: j.portal ?? null, apply_type: j.apply_type, url: j.url, score: (Array.isArray(j.job_scores) ? j.job_scores[0] : j.job_scores)?.score ?? null }] : [];
  });
  return { light, portalUnavailable };
}

/** Every application that matches, in the chosen order (ids only), for the CSV export. */
export async function matchingApplicationIds(q: AppQuery): Promise<string[]> {
  const { light } = await loadAppsLight(q);
  return sortApps(filterApps(light, q), q.sort, q.dir).map((r) => r.id);
}

export async function listApplicationsFiltered(q: AppQuery, paging: { page: number; size: number } = { page: 1, size: 25 }): Promise<AppsPage> {
  const { light, portalUnavailable } = await loadAppsLight(q);
  const counts = appStageCounts(filterAppsExceptStage(light, q));
  const matching = sortApps(filterApps(light, q), q.sort, q.dir);
  const r = pageRange(matching.length, paging.page, paging.size);
  const ids = matching.slice(r.from, r.to + 1).map((x) => x.id);
  if (ids.length === 0) return { rows: [], total: matching.length, totalAll: await tableTotal("applications", light.length), page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable, stageCounts: counts };
  const jobCols = `title,company,country,apply_type,source,url${portalUnavailable ? "" : ",portal"}`;
  const full = must<AppListRow[]>(await db().from("applications").select(`id,status,method,lifecycle,submitted_at,created_at,approved_at,error, job:jobs!inner(${jobCols}), resume:documents!applications_resume_doc_id_fkey(version)`).in("id", ids), "list applications");
  const order = new Map(ids.map((id, i) => [id, i]));
  return { rows: full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), total: matching.length, totalAll: await tableTotal("applications", light.length), page: r.page, pages: r.pages, shownFrom: r.shownFrom, shownTo: r.shownTo, portalUnavailable, stageCounts: counts };
}

export { appStage };
