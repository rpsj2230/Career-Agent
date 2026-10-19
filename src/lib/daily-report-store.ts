import "server-only";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { fetchAll } from "@/lib/fetch-all";
import { notifyProfile } from "@/lib/notify-profile";
import { isMissingSchemaError } from "@/lib/schema";
import { buildDailyReport, type DailyReport, type DailyReportInput, type RApp, type RJob } from "./daily-report";
import { appTimezone, localDate, localDayBounds } from "./time";

type Row = Record<string, unknown>;
const OPEN = ["prepared", "assisted_pending", "needs_input", "failed"];

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const r = await q;
  if (r.error) { if (isMissingSchemaError(r.error.message)) return []; throw new Error(r.error.message); }
  return r.data as Row[];
}
const asJob = (r: Row): RJob => ({ id: String(r.id), title: String(r.title), company: String(r.company), country: (r.country as string) ?? null, portal: (r.portal as string) ?? null, skip_reason: (r.skip_reason as string) ?? null });
const asApp = (r: Row): RApp => {
  const j = (Array.isArray(r.job) ? r.job[0] : r.job) as Row | null;
  return { id: String(r.id), title: String(j?.title ?? "Unknown job"), company: String(j?.company ?? ""), country: (j?.country as string) ?? null, portal: (j?.portal as string) ?? null, method: (r.method as string) ?? null, error: (r.error as string) ?? null };
};

/** Everything that happened on one local calendar day, plus what is open right now. */
export async function loadReportInput(date: string, timezone = appTimezone()): Promise<DailyReportInput> {
  const b = localDayBounds(date, timezone);
  if (!b) throw new Error(`Invalid report date: ${date}`);
  const jobCols = "id,title,company,country,portal,skip_reason";
  const appCols = "id,method,error, job:jobs(title,company,country,portal)";
  const [found, decided, created, sent, open, scans, runs] = await Promise.all([
    rows(fetchAll((a, z) => db().from("jobs").select(jobCols).gte("found_at", b.from).lte("found_at", b.to).order("id").range(a, z))),
    rows(fetchAll((a, z) => db().from("jobs").select(`${jobCols},status`).gte("decided_at", b.from).lte("decided_at", b.to).order("id").range(a, z))),
    rows(fetchAll((a, z) => db().from("applications").select(appCols).gte("created_at", b.from).lte("created_at", b.to).order("id").range(a, z))),
    rows(fetchAll((a, z) => db().from("applications").select(appCols).gte("submitted_at", b.from).lte("submitted_at", b.to).order("id").range(a, z))),
    rows(fetchAll((a, z) => db().from("applications").select(`${appCols},status`).in("status", OPEN).order("id").range(a, z))),
    rows(db().from("portal_scans").select("integration,error").eq("status", "error").gte("started_at", b.from).lte("started_at", b.to).limit(200)),
    rows(db().from("automation_runs").select("id,kind,error").eq("status", "failed").gte("started_at", b.from).lte("started_at", b.to).limit(100)),
  ]);
  const st = (r: Row) => String(r.status);
  return {
    date, timezone,
    found: found.map(asJob), matched: decided.filter((r) => st(r) !== "skipped").map(asJob), rejected: decided.filter((r) => st(r) === "skipped").map(asJob),
    prepared: created.map(asApp), submitted: sent.map(asApp),
    awaiting: open.filter((r) => st(r) === "prepared").map(asApp), manual: open.filter((r) => ["assisted_pending", "needs_input"].includes(st(r))).map(asApp), failed: open.filter((r) => st(r) === "failed").map(asApp),
    scanErrors: scans.map((r) => ({ integration: String(r.integration), error: String(r.error ?? "Scan failed") })),
    failedRuns: runs.map((r) => ({ id: String(r.id), kind: String(r.kind), error: (r.error as string) ?? null })),
  };
}

export type StoredReport = { id: string; report_date: string; timezone: string; status: "ok" | "error"; generated_at: string; summary: DailyReport["summary"]; items: DailyReport["items"]; body: string; delivered: boolean; error: string | null };

/**
 * Build and store the report for one day (running it again replaces that day's report), optionally send it to Telegram.
 * A failure is stored as an error report and logged rather than lost.
 */
export async function generateDailyReport(o: { date?: string; timezone?: string; send?: boolean } = {}): Promise<StoredReport> {
  const timezone = o.timezone ?? appTimezone();
  const date = o.date ?? localDate(0, timezone);
  try {
    const input = await loadReportInput(date, timezone);
    const report = buildDailyReport(input, process.env.APP_URL);
    const sent = o.send ? await notifyProfile(report.body, { subject: `Career Agent daily report ${date}` }) : null;
    const delivered = !!sent && (sent.telegram || sent.emailed.length > 0);
    const row = { report_date: date, timezone, status: "ok", generated_at: new Date().toISOString(), summary: report.summary, items: report.items, body: report.body, delivered, error: null };
    const res = await db().from("daily_reports").upsert(row, { onConflict: "report_date,timezone" }).select("*").single();
    if (res.error) throw new Error(res.error.message);
    await logActivity({ kind: "report.generated", message: `Daily report for ${date}: ${report.summary.submitted} submitted, ${report.summary.found} found${o.send ? (delivered ? ", sent to Telegram" : ", not sent (Telegram not configured or failed)") : ""}`, status: "ok", detail: { date, timezone, ...report.summary, delivered } });
    return res.data as StoredReport;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await logActivity({ kind: "report.failed", level: "error", message: `Daily report for ${date} failed: ${error}`, status: "failed", detail: { date, timezone, error } });
    throw e;
  }
}

export async function listReports(limit = 30): Promise<{ rows: StoredReport[]; missing: boolean }> {
  const res = await db().from("daily_reports").select("*").order("report_date", { ascending: false }).limit(limit);
  if (res.error) { if (isMissingSchemaError(res.error.message)) return { rows: [], missing: true }; throw new Error(res.error.message); }
  return { rows: res.data as StoredReport[], missing: false };
}

export async function getReport(date: string): Promise<StoredReport | null> {
  const res = await db().from("daily_reports").select("*").eq("report_date", date).order("generated_at", { ascending: false }).limit(1);
  if (res.error) { if (isMissingSchemaError(res.error.message)) return null; throw new Error(res.error.message); }
  return (res.data as StoredReport[])[0] ?? null;
}
