import "server-only";
import { db } from "@/lib/db";

/** Remember that a background task was just started from the site, so the page can say "starting" before its run record exists. */
export async function noteBackgroundStart(task: string) {
  try { await db().from("settings").upsert({ key: "background_task", value: { task, at: new Date().toISOString() }, updated_at: new Date().toISOString() }); } catch { /* informational */ }
}

export type BackgroundStatus =
  | { state: "idle" }
  | { state: "starting"; task: string; since: string }
  | { state: "running"; kind: string; since: string; stats: Record<string, number> }
  | { state: "finished"; kind: string; status: string; at: string; stats: Record<string, number>; error: string | null };

/** What the background work is doing right now, from the run records (and the "just started" note for the first minute). */
export async function backgroundStatus(now = new Date()): Promise<BackgroundStatus> {
  try {
    const [noted, runs] = await Promise.all([
      db().from("settings").select("value").eq("key", "background_task").maybeSingle(),
      db().from("automation_runs").select("kind,status,started_at,finished_at,stats,error,trigger").in("kind", ["scan", "score", "prepare", "pipeline"]).order("started_at", { ascending: false }).limit(1),
    ]);
    const run = runs.data?.[0] as { kind: string; status: string; started_at: string; finished_at: string | null; stats: Record<string, number>; error: string | null } | undefined;
    const note = noted.data?.value as { task?: string; at?: string } | null;
    const age = (iso: string) => now.getTime() - new Date(iso).getTime();
    if (run?.status === "running" && age(run.started_at) < 2 * 3_600_000) return { state: "running", kind: run.kind, since: run.started_at, stats: run.stats ?? {} };
    if (note?.at && age(note.at) < 8 * 60_000 && (!run || new Date(run.started_at) < new Date(note.at))) return { state: "starting", task: note.task ?? "task", since: note.at };
    if (run && run.finished_at && age(run.finished_at) < 24 * 3_600_000) return { state: "finished", kind: run.kind, status: run.status, at: run.finished_at, stats: run.stats ?? {}, error: run.error };
  } catch { /* the banner is optional */ }
  return { state: "idle" };
}
