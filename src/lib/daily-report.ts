export type RJob = { id: string; title: string; company: string; country: string | null; portal: string | null; skip_reason?: string | null };
export type RApp = { id: string; title: string; company: string; country: string | null; portal: string | null; method?: string | null; error?: string | null };

export type DailyReportInput = {
  date: string; timezone: string;
  found: RJob[]; matched: RJob[]; rejected: RJob[];
  prepared: RApp[]; submitted: RApp[];
  awaiting: RApp[]; manual: RApp[]; failed: RApp[];
  scanErrors: { integration: string; error: string }[];
  failedRuns: { id: string; kind: string; error: string | null }[];
};

export type ReportItem = { section: string; label: string; detail: string | null; href: string };
export const SECTION_TITLE: Record<string, string> = {
  submitted: "Submitted", awaiting: "Waiting for your approval", manual: "Needs you to press submit", failed: "Failed or needs input",
  prepared: "Prepared", matched: "Matched", rejected: "Rejected (with reasons)", found: "New jobs found", problems: "Source and run problems",
};
const ORDER = ["submitted", "awaiting", "manual", "failed", "prepared", "matched", "rejected", "found", "problems"] as const;
const MAX_ITEMS = 50;
const MAX_BODY_LINES = 6;

const where = (x: { country: string | null; portal: string | null }) => [x.country?.toUpperCase(), x.portal].filter(Boolean).join(" · ");
const jobItem = (section: string, j: RJob, detail?: string | null): ReportItem => ({ section, label: `${j.title} at ${j.company}`, detail: detail ?? (where(j) || null), href: `/jobs/${j.id}` });
const appItem = (section: string, a: RApp, detail?: string | null): ReportItem => ({ section, label: `${a.title} at ${a.company}`, detail: detail ?? (where(a) || null), href: `/applications/${a.id}` });

/**
 * One day's report: counts, then every notable item with a link to its job or application page.
 * Links are relative so they work wherever the app is hosted; the plain-text body adds the app address when known.
 */
export function buildDailyReport(i: DailyReportInput, appUrl?: string) {
  const summary = {
    found: i.found.length, matched: i.matched.length, rejected: i.rejected.length, prepared: i.prepared.length,
    submitted: i.submitted.length, submittedAuto: i.submitted.filter((a) => a.method === "automated").length,
    awaiting: i.awaiting.length, manual: i.manual.length, failed: i.failed.length, problems: i.scanErrors.length + i.failedRuns.length,
  };
  const bySection: Record<string, ReportItem[]> = {
    submitted: i.submitted.map((a) => appItem("submitted", a, [where(a), a.method === "automated" ? "automatic" : "by you"].filter(Boolean).join(" · "))),
    awaiting: i.awaiting.map((a) => appItem("awaiting", a)),
    manual: i.manual.map((a) => appItem("manual", a, a.error ?? "Open the posting, submit, then mark it submitted")),
    failed: i.failed.map((a) => appItem("failed", a, a.error ?? "No reason was recorded")),
    prepared: i.prepared.map((a) => appItem("prepared", a)),
    matched: i.matched.map((j) => jobItem("matched", j)),
    rejected: i.rejected.map((j) => jobItem("rejected", j, j.skip_reason ?? "No reason was recorded")),
    found: i.found.map((j) => jobItem("found", j)),
    problems: [
      ...i.scanErrors.map((s) => ({ section: "problems", label: `Scan failed: ${s.integration}`, detail: s.error, href: "/portals" })),
      ...i.failedRuns.map((r) => ({ section: "problems", label: `Run failed: ${r.kind}`, detail: r.error, href: `/logs/runs/${r.id}` })),
    ],
  };
  const items = ORDER.flatMap((k) => bySection[k].slice(0, MAX_ITEMS));
  const truncated = ORDER.filter((k) => bySection[k].length > MAX_ITEMS);

  const abs = (href: string) => (appUrl ? `${appUrl.replace(/\/$/, "")}${href}` : href);
  const lines = [`Career Agent daily report: ${i.date} (${i.timezone})`,
    `Found ${summary.found} · matched ${summary.matched} · rejected ${summary.rejected} · prepared ${summary.prepared} · submitted ${summary.submitted}`,
    `Now: ${summary.awaiting} waiting for approval · ${summary.manual} need you to submit · ${summary.failed} failed`];
  for (const k of ORDER) {
    if (["found", "matched", "rejected", "prepared"].includes(k) || bySection[k].length === 0) continue;
    lines.push("", `${SECTION_TITLE[k]} (${bySection[k].length})`);
    bySection[k].slice(0, MAX_BODY_LINES).forEach((it) => lines.push(`- ${it.label}${it.detail ? `: ${it.detail}` : ""}\n  ${abs(it.href)}`));
    if (bySection[k].length > MAX_BODY_LINES) lines.push(`  ...and ${bySection[k].length - MAX_BODY_LINES} more: ${abs(`/reports/daily/${i.date}`)}`);
  }
  lines.push("", `Full report: ${abs(`/reports/daily/${i.date}`)}`);
  return { summary, items, body: lines.join("\n"), truncated };
}
export type DailyReport = ReturnType<typeof buildDailyReport>;

/** A report date must be a real calendar date (YYYY-MM-DD). */
export function validDate(v: string | undefined | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}
