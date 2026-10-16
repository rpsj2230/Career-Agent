import { DateTime } from "luxon";

export const PERIODS = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
export type Period = keyof typeof PERIODS;
export const parsePeriod = (v: string | undefined): Period => (v && v in PERIODS ? (v as Period) : "7d");

/** Start of the period in the display time zone ("today" starts at local midnight, "7d" covers today and the six days before). */
export function periodStart(period: Period, now: Date, tz: string): Date {
  const local = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  return local.minus({ days: period === "today" ? 0 : period === "7d" ? 6 : 29 }).toUTC().toJSDate();
}

export type DashJob = { country: string | null; portal: string | null; status: string; found_at: string; decided_at: string | null };
export type DashApp = {
  id: string; status: string; method: string | null; created_at: string; submitted_at: string | null; error: string | null;
  country: string | null; portal: string | null; title: string; company: string;
};
export type DashScan = { integration: string; country: string | null; status: string; started_at: string; fetched: number; inserted: number; duplicates: number; error: string | null };
export type DashRun = { id: string; kind: string; status: string; started_at: string; finished_at: string | null; error: string | null; stats: Record<string, number> };

export type DashInput = { from: Date; jobs: DashJob[]; decided: DashJob[]; apps: DashApp[]; docs: number; scans: DashScan[]; runs: DashRun[] };

export type Breakdown = { key: string; found: number; matched: number; prepared: number; submitted: number; failed: number };

const inPeriod = (iso: string | null, from: Date) => !!iso && new Date(iso) >= from;
const bump = <K extends keyof Breakdown>(m: Map<string, Breakdown>, key: string | null, field: K) => {
  const k = key ?? "unknown";
  const row = m.get(k) ?? { key: k, found: 0, matched: 0, prepared: 0, submitted: 0, failed: 0 };
  (row[field] as number)++;
  m.set(k, row);
};
const sorted = (m: Map<string, Breakdown>) => [...m.values()].sort((a, b) => b.found + b.submitted + b.prepared - (a.found + a.submitted + a.prepared) || a.key.localeCompare(b.key));

/** Everything the dashboard shows, computed from plain rows so it can be tested without a database. */
export function summariseDashboard(i: DashInput) {
  const found = i.jobs.filter((j) => inPeriod(j.found_at, i.from));
  const decided = i.decided.filter((j) => inPeriod(j.decided_at, i.from));
  const matched = decided.filter((j) => j.status !== "skipped");
  const rejected = decided.filter((j) => j.status === "skipped");
  const prepared = i.apps.filter((a) => inPeriod(a.created_at, i.from));
  const submitted = i.apps.filter((a) => a.status === "submitted" && inPeriod(a.submitted_at, i.from));
  const scans = i.scans.filter((s) => inPeriod(s.started_at, i.from));
  const failedScans = scans.filter((s) => s.status === "error");
  const failedRuns = i.runs.filter((r) => r.status === "failed" && inPeriod(r.started_at, i.from));

  const byCountry = new Map<string, Breakdown>(), byPortal = new Map<string, Breakdown>();
  for (const [m, key] of [[byCountry, "country"], [byPortal, "portal"]] as const) {
    found.forEach((j) => bump(m, j[key], "found"));
    matched.forEach((j) => bump(m, j[key], "matched"));
    prepared.forEach((a) => bump(m, a[key], "prepared"));
    submitted.forEach((a) => bump(m, a[key], "submitted"));
    i.apps.filter((a) => a.status === "failed" && inPeriod(a.created_at, i.from)).forEach((a) => bump(m, a[key], "failed"));
  }

  const open = (statuses: string[]) => i.apps.filter((a) => statuses.includes(a.status));
  const awaiting = open(["prepared"]), manual = open(["assisted_pending", "needs_input"]), failed = open(["failed"]), inProgress = open(["approved", "submitting"]);

  return {
    period: {
      scans: scans.length, jobsFetched: scans.reduce((n, s) => n + s.fetched, 0), found: found.length,
      duplicates: scans.reduce((n, s) => n + s.duplicates, 0), matched: matched.length, rejected: rejected.length,
      documents: i.docs, prepared: prepared.length, submitted: submitted.length,
      submittedAuto: submitted.filter((a) => a.method === "automated").length, submittedManual: submitted.filter((a) => a.method !== "automated").length,
    },
    now: { awaiting: awaiting.length, manual: manual.length, failed: failed.length, inProgress: inProgress.length },
    funnel: [
      { key: "found", label: "Found", n: found.length },
      { key: "matched", label: "Matched", n: matched.length },
      { key: "prepared", label: "Prepared", n: prepared.length },
      { key: "submitted", label: "Submitted", n: submitted.length },
    ],
    byCountry: sorted(byCountry),
    byPortal: sorted(byPortal),
    /** why things did not go through: stuck applications first, then broken scans and runs */
    problems: [
      ...[...failed, ...manual].slice(0, 10).map((a) => ({ kind: "application" as const, id: a.id, title: `${a.title} at ${a.company}`, status: a.status, reason: a.error ?? (a.status === "assisted_pending" ? "Prepared; waiting for you to press the final submit on the employer's site" : a.status === "needs_input" ? "Needs your input" : "No reason was recorded") })),
      ...failedScans.slice(0, 5).map((s) => ({ kind: "scan" as const, id: s.integration, title: `${s.integration}${s.country ? ` (${s.country.toUpperCase()})` : ""}`, status: "error", reason: s.error ?? "Scan failed" })),
      ...failedRuns.slice(0, 5).map((r) => ({ kind: "run" as const, id: r.id, title: `${r.kind} run`, status: "failed", reason: r.error ?? "Run failed" })),
    ],
  };
}
export type DashboardSummary = ReturnType<typeof summariseDashboard>;
