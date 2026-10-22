import "server-only";
import { db } from "@/lib/db";
import { fetchAll } from "@/lib/fetch-all";
import { modelLines, type ModelLine, type UsageRow } from "@/lib/run-view";
import type { RunRow } from "@/lib/log-queries";

export type RunJob = { id: string; title: string; company: string; country: string | null; portal: string | null; source: string | null; status: string; found_at: string; score: number | null };
export type RunApplication = { id: string; status: string; portal: string | null; country: string | null; created_at: string; approved_at: string | null; submitted_at: string | null; error: string | null; title: string; company: string };
export type RunProblem = { id: number; at: string; level: string; kind: string; message: string; company: string | null };

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
const LIMIT = 300;

/** Jobs this run found (newest first), with their score. */
export async function runJobs(runId: string): Promise<{ rows: RunJob[]; total: number }> {
  const res = await db().from("jobs").select("id,title,company,country,portal,source,status,found_at,job_scores(score)", { count: "exact" }).eq("run_id", runId).order("found_at", { ascending: false }).limit(LIMIT);
  if (res.error) return { rows: [], total: 0 };
  const rows = (res.data as unknown as (Omit<RunJob, "score"> & { job_scores: { score: number } | { score: number }[] | null })[]).map(({ job_scores, ...j }) => ({ ...j, score: one(job_scores)?.score ?? null }));
  return { rows, total: res.count ?? rows.length };
}

/** Applications this run prepared, with where each one stands now. */
export async function runApplications(runId: string): Promise<{ rows: RunApplication[]; total: number }> {
  const res = await db().from("applications").select("id,status,portal,country,created_at,approved_at,submitted_at,error,job:jobs(title,company)", { count: "exact" }).eq("run_id", runId).order("created_at", { ascending: false }).limit(LIMIT);
  if (res.error) return { rows: [], total: 0 };
  const rows = (res.data as unknown as (Omit<RunApplication, "title" | "company"> & { job: { title: string; company: string } | { title: string; company: string }[] | null })[]).map(({ job, ...a }) => ({ ...a, title: one(job)?.title ?? "(job removed)", company: one(job)?.company ?? "" }));
  return { rows, total: res.count ?? rows.length };
}

/** Warnings and errors logged during the run. */
export async function runProblems(runId: string): Promise<RunProblem[]> {
  const res = await db().from("activity_log").select("id,at,level,kind,message,company").eq("run_id", runId).in("level", ["warn", "error"]).order("at", { ascending: true }).limit(200);
  return res.error ? [] : (res.data as RunProblem[]);
}

/**
 * Which AI models were used while the run was going. Calls are not tied to a run in the database, so this is every call made between
 * the run's start and its end: a second run working at the same moment (another profile, a backlog round) would be included.
 */
export async function runModels(run: Pick<RunRow, "started_at" | "finished_at">): Promise<ModelLine[]> {
  const to = run.finished_at ?? new Date().toISOString();
  const res = await fetchAll((a, b) => db().from("model_usage").select("model_label,task,ok,error,input_tokens,output_tokens,latency_ms").gte("created_at", run.started_at).lte("created_at", to).order("id").range(a, b), 20_000);
  return res.error ? [] : modelLines(res.data as UsageRow[]);
}

/** Recent pipeline runs of every schedule and of the hourly backlog rounds, newest first. */
export async function recentPipelineRuns(limit = 20): Promise<RunRow[]> {
  const res = await db().from("automation_runs").select("*").eq("kind", "pipeline").order("started_at", { ascending: false }).limit(limit);
  return res.error ? [] : (res.data as RunRow[]);
}
