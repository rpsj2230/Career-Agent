import "server-only";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { summariseDashboard, type DashApp, type DashJob, type DashRun, type DashScan, type Period, periodStart } from "./dashboard";
import { appTimezone } from "./time";

type Row = Record<string, unknown>;
const OPEN = ["prepared", "approved", "submitting", "assisted_pending", "needs_input", "failed"];

/** Rows for the dashboard. A table or column that the database update has not created yet yields no rows and sets `limited`. */
export async function loadDashboard(o: { period: Period; country?: string }, now = new Date()) {
  const from = periodStart(o.period, now, appTimezone());
  const iso = from.toISOString();
  let limited = false;
  const guard = async <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, empty: T): Promise<T> => {
    const r = await q;
    if (r.error) {
      if (isMissingSchemaError(r.error.message)) { limited = true; return empty; }
      throw new Error(r.error.message);
    }
    return r.data as T;
  };
  const c = o.country;

  const jobCols = "country,portal,status,found_at,decided_at";
  const jobsQ = (extra: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => extra(base()).limit(5000);
  const base = () => { const q = db().from("jobs").select(jobCols); return c ? q.eq("country", c) : q; };
  const [jobs, decided] = await Promise.all([
    guard<DashJob[]>(jobsQ((q) => q.gte("found_at", iso)), []),
    guard<DashJob[]>(jobsQ((q) => q.gte("decided_at", iso)), []),
  ]);

  const appSelect = `id,status,method,created_at,submitted_at,error, job:jobs${c ? "!inner" : ""}(title,company,country,portal)`;
  const appQ = () => { const q = db().from("applications").select(appSelect); return (c ? q.eq("job.country", c) : q).limit(2000); };
  const [created, sent, open] = await Promise.all([
    guard<Row[]>(appQ().gte("created_at", iso), []),
    guard<Row[]>(appQ().gte("submitted_at", iso), []),
    guard<Row[]>(appQ().in("status", OPEN), []),
  ]);
  const apps = new Map<string, DashApp>();
  for (const r of [...created, ...sent, ...open]) {
    const j = (Array.isArray(r.job) ? r.job[0] : r.job) as { title: string; company: string; country: string | null; portal: string | null } | null;
    apps.set(String(r.id), {
      id: String(r.id), status: String(r.status), method: (r.method as string) ?? null, created_at: String(r.created_at), submitted_at: (r.submitted_at as string) ?? null,
      error: (r.error as string) ?? null, country: j?.country ?? null, portal: j?.portal ?? null, title: j?.title ?? "Unknown job", company: j?.company ?? "",
    });
  }

  const docsQ = db().from("documents").select(`id, job:jobs${c ? "!inner" : ""}(country)`, { count: "exact", head: true }).gte("created_at", iso);
  const docsRes = await (c ? docsQ.eq("job.country", c) : docsQ);
  const docs = docsRes.error ? 0 : docsRes.count ?? 0;

  const scanQ = db().from("portal_scans").select("integration,country,status,started_at,fetched,inserted,duplicates,error").gte("started_at", iso).limit(2000);
  const scans = await guard<DashScan[]>(c ? scanQ.eq("country", c) : scanQ, []);
  const runs = await guard<DashRun[]>(db().from("automation_runs").select("id,kind,status,started_at,finished_at,error,stats").order("started_at", { ascending: false }).limit(10), []);

  return { from, limited, runs, summary: summariseDashboard({ from, jobs, decided, apps: [...apps.values()], docs, scans, runs }) };
}
