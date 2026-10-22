import { applyRoute, type ApplyRoute } from "@/lib/apply/route";
import { safeSearch } from "@/lib/filters";

/**
 * Filtering, sorting and the pipeline "stage" of jobs and applications for the Jobs and Applications lists.
 * Pure (no database): src/lib/queries.ts loads light rows, these functions do the rest, so every rule is tested.
 * Everything lives in the URL (links can be bookmarked and shared); unknown values are dropped.
 */

// ---------------------------------------------------------------- stages: where an item stands in the pipeline
export const STAGES = {
  unscored: { label: "Not scored yet", hint: "Found, waiting for an AI fit score" },
  matched: { label: "Matched, resume not ready", hint: "A good fit; its resume and cover letter are not written yet" },
  awaiting_approval: { label: "Waiting for your approval", hint: "Resume ready: open it and press Approve" },
  sending: { label: "Being sent", hint: "Approved and on its way (cloud)" },
  waiting_assistant: { label: "Waiting for assistant / you", hint: "Needs the assistant on your computer, or you to press Submit" },
  needs_input: { label: "Needs your input", hint: "The form asked something your profile cannot answer" },
  failed: { label: "Failed", hint: "The last attempt failed; apply again or write a new resume" },
  applied: { label: "Applied", hint: "Sent" },
  saved: { label: "Saved for later", hint: "You saved it" },
  rejected: { label: "Rejected (with reasons)", hint: "Closed out by the rules or by you" },
} as const;
export type StageKey = keyof typeof STAGES;
export const STAGE_ORDER = Object.keys(STAGES) as StageKey[];
/** The order a job travels, used by "sort by stage". */
const STAGE_RANK: Record<StageKey, number> = { unscored: 0, matched: 1, awaiting_approval: 2, sending: 3, waiting_assistant: 4, needs_input: 5, failed: 6, applied: 7, saved: 8, rejected: 9 };
const STAGE_ALIAS: Record<string, StageKey> = { in_progress: "sending", inprogress: "sending", pending: "awaiting_approval", manual: "waiting_assistant", submitted: "applied", queue: "matched", new: "unscored", skipped: "rejected" };

export function jobStage(jobStatus: string, appStatus: string | null): StageKey {
  switch (jobStatus) {
    case "new": return "unscored";
    case "queued": return "matched";
    case "saved": return "saved";
    case "skipped": return "rejected";
    case "applied": return "applied";
    default: return appStage(appStatus) ?? "awaiting_approval";
  }
}
export function appStage(appStatus: string | null | undefined): StageKey | null {
  switch (appStatus) {
    case "prepared": return "awaiting_approval";
    case "approved": case "submitting": return "sending";
    case "assisted_pending": return "waiting_assistant";
    case "needs_input": return "needs_input";
    case "failed": return "failed";
    case "submitted": return "applied";
    default: return null;
  }
}

/** The old ?view= values of the Jobs page and ?status= values of the Applications page keep working. */
const JOB_VIEW_STAGES: Record<string, StageKey[]> = {
  queue: ["matched", "awaiting_approval", "sending", "waiting_assistant", "needs_input", "failed", "saved"],
  new: ["unscored"], skipped: ["rejected"], applied: ["applied"], all: [],
};
const APP_STATUS_STAGES: Record<string, StageKey[]> = {
  all: [], pending: ["awaiting_approval"], manual: ["waiting_assistant", "needs_input"], submitted: ["applied"], failed: ["failed"], inprogress: ["sending"],
};
export const APP_STAGES: StageKey[] = ["awaiting_approval", "sending", "waiting_assistant", "needs_input", "failed", "applied"];
/** The Jobs page opens on every job: found, scored, skipped, in progress and applied, so nothing seems to be missing. */
export const JOB_DEFAULT_STAGES: StageKey[] = [];

/** The Jobs page groups the ten pipeline stages into the few places a job can be, so the chips read as a journey. */
export const JOB_GROUPS: { key: string; label: string; hint: string; stages: StageKey[] }[] = [
  { key: "unscored", label: "Not scored yet", hint: "Found, waiting for a fit score", stages: ["unscored"] },
  { key: "skipped", label: "Skipped (poor fit)", hint: "Scored below your threshold, or closed out by your rules, with the reason", stages: ["rejected"] },
  { key: "matched", label: "Good fit, no resume yet", hint: "A good fit; its resume and cover letter are written automatically", stages: ["matched"] },
  { key: "progress", label: "Being applied for", hint: "Resume ready, waiting for approval, or on its way", stages: ["awaiting_approval", "sending", "waiting_assistant"] },
  { key: "attention", label: "Needs you", hint: "A worker could not finish: open it to see why", stages: ["needs_input", "failed"] },
  { key: "applied", label: "Applied", hint: "Sent", stages: ["applied"] },
  { key: "saved", label: "Saved for later", hint: "You saved it", stages: ["saved"] },
];

// ---------------------------------------------------------------- parsing the URL
type SP = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const score = (v: string | undefined) => { if (v === undefined || v === "") return undefined; const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : undefined; };
const code = (xs: string[], re: RegExp) => uniq(xs.map((x) => x.toLowerCase()).filter((x) => re.test(x))).slice(0, 30);

export const ROUTE_KINDS = ["cloud", "assistant", "email", "manual"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];
export const ROUTE_LABEL: Record<RouteKind, string> = { cloud: "Automatic (cloud)", assistant: "Assistant (your computer)", email: "Email to the employer", manual: "Manual (you submit)" };

export const JOB_SORTS = {
  score: { label: "Fit score", dir: "desc" as const },
  found: { label: "Date found", dir: "desc" as const },
  posted: { label: "Date posted", dir: "desc" as const },
  company: { label: "Company", dir: "asc" as const },
  title: { label: "Job title", dir: "asc" as const },
  country: { label: "Country", dir: "asc" as const },
  stage: { label: "Pipeline stage", dir: "asc" as const },
} as const;
export type JobSortKey = keyof typeof JOB_SORTS;

export type JobQuery = {
  stages: StageKey[]; portals: string[]; /** how the job reached the app: mailbox, adzuna, apify, ... */ vias: string[]; countries: string[]; methods: RouteKind[];
  q?: string; scoreMin?: number; scoreMax?: number; from?: string; to?: string;
  sort: JobSortKey; dir: "asc" | "desc";
};

export function parseJobQuery(sp: SP): JobQuery {
  let stages = uniq(all(sp.stage).map((s) => STAGE_ALIAS[s] ?? s).filter((s): s is StageKey => s in STAGES));
  const view = first(sp.view);
  if (stages.length === 0 && view && view in JOB_VIEW_STAGES) stages = JOB_VIEW_STAGES[view];
  const sort = (first(sp.sort) as JobSortKey | undefined) && (first(sp.sort) as string) in JOB_SORTS ? (first(sp.sort) as JobSortKey) : "score";
  const dir = first(sp.dir) === "asc" || first(sp.dir) === "desc" ? (first(sp.dir) as "asc" | "desc") : JOB_SORTS[sort].dir;
  const portal = all(sp.portal), country = all(sp.country);
  const q = safeSearch(first(sp.q));
  return {
    stages, portals: code(portal, /^[a-z0-9]{1,40}$/), vias: code(all(sp.via), /^[a-z0-9]{1,40}$/), countries: code(country, /^[a-z]{2}$/),
    methods: uniq(all(sp.method).filter((m): m is RouteKind => (ROUTE_KINDS as readonly string[]).includes(m))),
    q: q || undefined, scoreMin: score(first(sp.score_min)), scoreMax: score(first(sp.score_max)), from: date(first(sp.from)), to: date(first(sp.to)), sort, dir,
  };
}

// ---------------------------------------------------------------- jobs
export type JobLight = {
  id: string; title: string; company: string; country: string | null; location: string | null; status: string; found_at: string; posted_at: string | null;
  portal: string | null; source?: string | null; apply_type: string; url: string; score: number | null; appStatus: string | null;
};
export const routeOf = (r: Pick<JobLight, "apply_type" | "url" | "portal">): ApplyRoute => applyRoute({ apply_type: r.apply_type, url: r.url, portal: r.portal });

const matchesText = (hay: string[], q: string) => { const t = hay.join(" ").toLowerCase(); return q.toLowerCase().split(" ").filter(Boolean).every((w) => t.includes(w)); };
const day = (iso: string) => iso.slice(0, 10);

/** Every filter except the stage, so the stage chips can show how many each would give. */
export function filterJobsExceptStage(rows: JobLight[], q: JobQuery): JobLight[] {
  return rows.filter((r) =>
    (!q.portals.length || (r.portal !== null && q.portals.includes(r.portal))) &&
    (!q.vias.length || (r.source != null && q.vias.includes(r.source.split(":")[0]))) &&
    (!q.countries.length || (r.country !== null && q.countries.includes(r.country.toLowerCase()))) &&
    (!q.methods.length || q.methods.includes(routeOf(r).kind)) &&
    (q.scoreMin === undefined || (r.score !== null && r.score >= q.scoreMin)) &&
    (q.scoreMax === undefined || (r.score !== null && r.score <= q.scoreMax)) &&
    (!q.from || day(r.found_at) >= q.from) && (!q.to || day(r.found_at) <= q.to) &&
    (!q.q || matchesText([r.title, r.company, r.location ?? ""], q.q)));
}
export const filterJobs = (rows: JobLight[], q: JobQuery): JobLight[] => filterJobsExceptStage(rows, q).filter((r) => !q.stages.length || q.stages.includes(jobStage(r.status, r.appStatus)));

export function stageCounts(rows: JobLight[]): Record<StageKey, number> {
  const out = Object.fromEntries(STAGE_ORDER.map((k) => [k, 0])) as Record<StageKey, number>;
  for (const r of rows) out[jobStage(r.status, r.appStatus)]++;
  return out;
}

const cmpText = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
/** Missing values (no score, no posted date) always go last, whichever way you sort. */
export function sortJobs(rows: JobLight[], sort: JobSortKey, dir: "asc" | "desc"): JobLight[] {
  const sign = dir === "asc" ? 1 : -1;
  const num = (a: number | null, b: number | null) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * sign);
  const key = (r: JobLight): number | null => (sort === "score" ? r.score : sort === "found" ? Date.parse(r.found_at) : sort === "posted" ? (r.posted_at ? Date.parse(r.posted_at) : null) : sort === "stage" ? STAGE_RANK[jobStage(r.status, r.appStatus)] : null);
  return [...rows].sort((a, b) => {
    let c = 0;
    if (sort === "company") c = cmpText(a.company, b.company) * sign;
    else if (sort === "title") c = cmpText(a.title, b.title) * sign;
    else if (sort === "country") c = (a.country === null ? (b.country === null ? 0 : 1) : b.country === null ? -1 : cmpText(a.country, b.country) * sign);
    else c = num(key(a), key(b));
    return c || num(a.score, b.score) || Date.parse(b.found_at) - Date.parse(a.found_at) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------- applications
export const LIFECYCLES = ["none", "applied", "interview", "offer", "rejected", "withdrawn"] as const;
export const LIFECYCLE_LABEL: Record<string, string> = { none: "No outcome yet", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn" };
export const APP_SORTS = {
  queue: { label: "Next to apply (best score first, applied last)", dir: "desc" as const },
  created: { label: "Date prepared", dir: "desc" as const },
  submitted: { label: "Date submitted", dir: "desc" as const },
  company: { label: "Company", dir: "asc" as const },
  title: { label: "Job title", dir: "asc" as const },
  country: { label: "Country", dir: "asc" as const },
  stage: { label: "Status", dir: "asc" as const },
} as const;
export type AppSortKey = keyof typeof APP_SORTS;
export type AppQuery = {
  stages: StageKey[]; lifecycles: string[]; portals: string[]; countries: string[]; methods: RouteKind[];
  q?: string; from?: string; to?: string; sentFrom?: string; sentTo?: string; sort: AppSortKey; dir: "asc" | "desc";
};

export function parseAppQuery(sp: SP): AppQuery {
  let stages = uniq(all(sp.stage).map((s) => STAGE_ALIAS[s] ?? s).filter((s): s is StageKey => APP_STAGES.includes(s as StageKey)));
  const status = first(sp.status);
  if (stages.length === 0 && status && status in APP_STATUS_STAGES) stages = APP_STATUS_STAGES[status];
  const sort = (first(sp.sort) as string) in APP_SORTS ? (first(sp.sort) as AppSortKey) : "queue";
  const dir = first(sp.dir) === "asc" || first(sp.dir) === "desc" ? (first(sp.dir) as "asc" | "desc") : APP_SORTS[sort].dir;
  const q = safeSearch(first(sp.q));
  return {
    stages, lifecycles: uniq(all(sp.lifecycle).filter((l) => (LIFECYCLES as readonly string[]).includes(l))),
    portals: code(all(sp.portal), /^[a-z0-9]{1,40}$/), countries: code(all(sp.country), /^[a-z]{2}$/),
    methods: uniq(all(sp.method).filter((m): m is RouteKind => (ROUTE_KINDS as readonly string[]).includes(m))),
    q: q || undefined, from: date(first(sp.from)), to: date(first(sp.to)), sentFrom: date(first(sp.sent_from)), sentTo: date(first(sp.sent_to)), sort, dir,
  };
}

export type AppLight = {
  id: string; status: string; method: string | null; lifecycle: string; submitted_at: string | null; created_at: string;
  title: string; company: string; country: string | null; portal: string | null; apply_type: string; url: string; /** the job's fit score, when it has one */ score?: number | null;
};
export const appRouteOf = (r: Pick<AppLight, "apply_type" | "url" | "portal">): ApplyRoute => applyRoute({ apply_type: r.apply_type, url: r.url, portal: r.portal });

export function filterAppsExceptStage(rows: AppLight[], q: AppQuery): AppLight[] {
  return rows.filter((r) =>
    (!q.lifecycles.length || q.lifecycles.includes(r.lifecycle)) &&
    (!q.portals.length || (r.portal !== null && q.portals.includes(r.portal))) &&
    (!q.countries.length || (r.country !== null && q.countries.includes(r.country.toLowerCase()))) &&
    (!q.methods.length || q.methods.includes(appRouteOf(r).kind)) &&
    (!q.from || day(r.created_at) >= q.from) && (!q.to || day(r.created_at) <= q.to) &&
    (!q.sentFrom || (r.submitted_at !== null && day(r.submitted_at) >= q.sentFrom)) && (!q.sentTo || (r.submitted_at !== null && day(r.submitted_at) <= q.sentTo)) &&
    (!q.q || matchesText([r.title, r.company], q.q)));
}
export const filterApps = (rows: AppLight[], q: AppQuery): AppLight[] => filterAppsExceptStage(rows, q).filter((r) => !q.stages.length || q.stages.includes(appStage(r.status) as StageKey));
export function appStageCounts(rows: AppLight[]): Record<StageKey, number> {
  const out = Object.fromEntries(STAGE_ORDER.map((k) => [k, 0])) as Record<StageKey, number>;
  for (const r of rows) { const s = appStage(r.status); if (s) out[s]++; }
  return out;
}
export function sortApps(rows: AppLight[], sort: AppSortKey, dir: "asc" | "desc"): AppLight[] {
  const sign = dir === "asc" ? 1 : -1;
  const time = (iso: string | null) => (iso ? Date.parse(iso) : null);
  const num = (a: number | null, b: number | null) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * sign);
  return [...rows].sort((a, b) => {
    let c = 0;
    if (sort === "queue") { const group = (x: AppLight) => (x.status === "submitted" ? 1 : 0); c = group(a) - group(b) || num(a.score ?? null, b.score ?? null); } // still to apply first, best score first, applied last
    else if (sort === "company") c = cmpText(a.company, b.company) * sign;
    else if (sort === "title") c = cmpText(a.title, b.title) * sign;
    else if (sort === "country") c = a.country === null ? (b.country === null ? 0 : 1) : b.country === null ? -1 : cmpText(a.country, b.country) * sign;
    else if (sort === "stage") c = num(STAGE_RANK[appStage(a.status) ?? "rejected"], STAGE_RANK[appStage(b.status) ?? "rejected"]);
    else if (sort === "submitted") c = num(time(a.submitted_at), time(b.submitted_at));
    else c = num(time(a.created_at), time(b.created_at));
    return c || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------- links: one function builds every URL so filters, sort and paging stay together
export type Link = Record<string, string | string[] | number | undefined | null>;
export function queryString(params: Link): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { for (const x of v) u.append(k, x); } else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export function jobQueryParams(q: JobQuery, over: Link = {}): Link {
  const base: Link = {
    stage: q.stages.length === 0 ? undefined : q.stages, portal: q.portals, via: q.vias, country: q.countries, method: q.methods,
    q: q.q, score_min: q.scoreMin, score_max: q.scoreMax, from: q.from, to: q.to,
    sort: q.sort === "score" ? undefined : q.sort, dir: q.dir === JOB_SORTS[q.sort].dir ? undefined : q.dir,
  };
  return { ...base, ...over };
}
export function appQueryParams(q: AppQuery, over: Link = {}): Link {
  const base: Link = {
    stage: q.stages.length === 0 ? undefined : q.stages, lifecycle: q.lifecycles, portal: q.portals, country: q.countries, method: q.methods,
    q: q.q, from: q.from, to: q.to, sent_from: q.sentFrom, sent_to: q.sentTo,
    sort: q.sort === "queue" ? undefined : q.sort, dir: q.dir === APP_SORTS[q.sort].dir ? undefined : q.dir,
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------- the "active filters" pills: each says what is applied and how to take just that one off
export type Pill = { label: string; over: Link };
export function activePills(kind: "jobs" | "apps", q: JobQuery | AppQuery, names: { portal: (k: string) => string; via?: (k: string) => string; country: (k: string) => string; stage: (k: StageKey) => string }, defaultStages: StageKey[] = []): Pill[] {
  const out: Pill[] = [];
  const isDefault = q.stages.length === defaultStages.length && defaultStages.every((s) => q.stages.includes(s));
  if (q.stages.length && !isDefault) for (const s of q.stages) out.push({ label: names.stage(s), over: { stage: q.stages.filter((x) => x !== s).length ? q.stages.filter((x) => x !== s) : "all", page: undefined } });
  for (const p of q.portals) out.push({ label: `Portal: ${names.portal(p)}`, over: { portal: q.portals.filter((x) => x !== p), page: undefined } });
  for (const c of q.countries) out.push({ label: `Country: ${names.country(c)}`, over: { country: q.countries.filter((x) => x !== c), page: undefined } });
  for (const m of q.methods) out.push({ label: `Applied via: ${ROUTE_LABEL[m]}`, over: { method: q.methods.filter((x) => x !== m), page: undefined } });
  if (q.q) out.push({ label: `Search: “${q.q}”`, over: { q: undefined, page: undefined } });
  if (kind === "jobs") {
    const j = q as JobQuery;
    for (const v of j.vias) out.push({ label: `Found via: ${names.via ? names.via(v) : v}`, over: { via: j.vias.filter((x) => x !== v), page: undefined } });
    if (j.scoreMin !== undefined) out.push({ label: `Score ≥ ${j.scoreMin}`, over: { score_min: undefined, page: undefined } });
    if (j.scoreMax !== undefined) out.push({ label: `Score ≤ ${j.scoreMax}`, over: { score_max: undefined, page: undefined } });
    if (j.from) out.push({ label: `Found from ${j.from}`, over: { from: undefined, page: undefined } });
    if (j.to) out.push({ label: `Found until ${j.to}`, over: { to: undefined, page: undefined } });
  } else {
    const a = q as AppQuery;
    for (const l of a.lifecycles) out.push({ label: `Outcome: ${LIFECYCLE_LABEL[l] ?? l}`, over: { lifecycle: a.lifecycles.filter((x) => x !== l), page: undefined } });
    if (a.from) out.push({ label: `Prepared from ${a.from}`, over: { from: undefined, page: undefined } });
    if (a.to) out.push({ label: `Prepared until ${a.to}`, over: { to: undefined, page: undefined } });
    if (a.sentFrom) out.push({ label: `Sent from ${a.sentFrom}`, over: { sent_from: undefined, page: undefined } });
    if (a.sentTo) out.push({ label: `Sent until ${a.sentTo}`, over: { sent_to: undefined, page: undefined } });
  }
  return out;
}
