import "server-only";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { logConfig } from "./activity-helpers";
import { BLANK_SCHEDULE, computeNextRun, isDue, ScheduleInput, type ScheduleConfig, type ScheduleRow } from "./schedule";
import { appTimezone } from "./time";

const fromDb = (r: Record<string, unknown>): ScheduleRow | null => {
  const p = ScheduleInput.safeParse(r);
  if (!p.success) return null; // a row that no longer validates is skipped, not crashed on
  return {
    ...p.data, id: String(r.id), paused: !!r.paused,
    last_run_at: (r.last_run_at as string) ?? null, last_run_status: (r.last_run_status as string) ?? null,
    next_run_at: (r.next_run_at as string) ?? null, created_at: String(r.created_at),
  };
};

export async function listSchedules(): Promise<{ rows: ScheduleRow[]; missing: boolean }> {
  const res = await db().from("schedules").select("*").order("created_at");
  if (res.error) {
    if (isMissingSchemaError(res.error.message)) return { rows: [], missing: true };
    throw new Error(`load schedules: ${res.error.message}`);
  }
  return { rows: (res.data as Record<string, unknown>[]).flatMap((r) => fromDb(r) ?? []), missing: false };
}

export async function getSchedule(id: string): Promise<ScheduleRow | null> {
  const res = await db().from("schedules").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data ? fromDb(res.data as Record<string, unknown>) : null;
}

const nextFor = (c: ScheduleConfig, paused: boolean, now: Date) => (c.enabled && !paused ? computeNextRun(c, now).toISOString() : null);

export async function createSchedule(c: ScheduleConfig, now = new Date()): Promise<ScheduleRow> {
  const res = await db().from("schedules").insert({ ...c, paused: false, next_run_at: nextFor(c, false, now) }).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return fromDb(res.data as Record<string, unknown>)!;
}

export async function updateSchedule(id: string, c: ScheduleConfig, now = new Date()): Promise<ScheduleRow | null> {
  const cur = await getSchedule(id);
  if (!cur) return null;
  const res = await db().from("schedules").update({ ...c, next_run_at: nextFor(c, cur.paused, now), updated_at: now.toISOString() }).eq("id", id).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return fromDb(res.data as Record<string, unknown>);
}

/** Pause keeps the schedule but stops it firing; resume recomputes from now, so missed runs are never replayed. */
export async function setPaused(id: string, paused: boolean, now = new Date()): Promise<ScheduleRow | null> {
  const cur = await getSchedule(id);
  if (!cur) return null;
  const res = await db().from("schedules").update({ paused, next_run_at: nextFor(cur, paused, now), updated_at: now.toISOString() }).eq("id", id).select("*").single();
  if (res.error) throw new Error(res.error.message);
  return fromDb(res.data as Record<string, unknown>);
}

export async function deleteSchedule(id: string) {
  const { error } = await db().from("schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Schedules that should run now. Each is claimed by moving next_run_at forward only if it still has the value we read,
 * so two overlapping ticks can never both run the same schedule.
 */
export async function claimDueSchedules(now = new Date()): Promise<ScheduleRow[]> {
  const { rows } = await listSchedules();
  const claimed: ScheduleRow[] = [];
  for (const s of rows) {
    if (!isDue(s, now)) continue;
    let q = db().from("schedules").update({ next_run_at: computeNextRun(s, now).toISOString(), updated_at: now.toISOString() }).eq("id", s.id);
    q = s.next_run_at === null ? q.is("next_run_at", null) : q.eq("next_run_at", s.next_run_at);
    const res = await q.select("id");
    if (res.error) throw new Error(res.error.message);
    if ((res.data ?? []).length === 1) claimed.push(s);
  }
  return claimed;
}

/** A run that failed, or stopped part-way because no model could be used, is tried again in an hour, at most three times in a row. */
export const RETRY_AFTER_MS = 60 * 60_000;
export const MAX_RETRIES = 3;
export function shouldRetry(status: string, latestError: string | null, recent: { status: string }[]): boolean {
  const transient = status === "failed" || (status === "partial" && /no model|all models failed|rate.?limit|quota|429|timed? ?out|econn|network/i.test(latestError ?? ""));
  if (!transient) return false;
  return recent.slice(0, MAX_RETRIES).filter((r) => r.status === "failed" || r.status === "partial").length < MAX_RETRIES;
}

export async function recordScheduleRun(id: string, status: string, at = new Date()) {
  const patch: Record<string, unknown> = { last_run_at: at.toISOString(), last_run_status: status };
  if (status === "failed" || status === "partial") {
    // do not wait a whole day for the next slot when the cause is probably temporary (the laptop is not involved: this runs in the cloud)
    const recent = await db().from("automation_runs").select("status,error").eq("schedule_id", id).eq("kind", "pipeline").order("started_at", { ascending: false }).limit(MAX_RETRIES);
    const rows = (recent.data ?? []) as { status: string; error: string | null }[];
    if (shouldRetry(status, rows[0]?.error ?? null, rows)) {
      patch.next_run_at = new Date(at.getTime() + RETRY_AFTER_MS).toISOString();
      await logConfig(`Schedule run ${status}: trying again in an hour`, { schedule_id: id, reason: rows[0]?.error ?? null }, "schedule.changed").catch(() => undefined);
    }
  }
  const { error } = await db().from("schedules").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** True once you have at least one active schedule; the old fixed-time jobs then stand down so nothing runs twice. */
export async function hasActiveSchedules(): Promise<boolean> {
  try { return (await listSchedules()).rows.some((s) => s.enabled && !s.paused); } catch { return false; }
}

/**
 * First-run setup: when no schedule has ever existed, create the recommended one (daily at 09:00, find + score + prepare,
 * wait for your approval). It happens once: a flag is stored, so deleting the schedule later is respected and it is never
 * recreated. Nothing is submitted by it: sending needs your approval, or the Auto-Apply switch.
 */
export async function seedRecommendedSchedule(existing: number, now = new Date()): Promise<ScheduleRow | null> {
  if (existing > 0) return null;
  const flag = await db().from("settings").select("key").eq("key", "schedule_seeded").maybeSingle();
  if (flag.error || flag.data) return null;
  const created = await createSchedule({ ...BLANK_SCHEDULE, name: "Daily search and prepare", time_of_day: "09:00", timezone: appTimezone() }, now);
  // the first run happens at the next check rather than tomorrow morning, so there is something to see straight away
  const dueAt = new Date(now.getTime() - 60_000).toISOString();
  await db().from("schedules").update({ next_run_at: dueAt }).eq("id", created.id);
  const row = { ...created, next_run_at: dueAt };
  await db().from("settings").upsert({ key: "schedule_seeded", value: { at: now.toISOString() }, updated_at: now.toISOString() });
  await logConfig("Recommended schedule created automatically (first run): daily at 09:00, find, score and prepare; nothing is sent without your approval", { schedule_id: row.id });
  return row;
}
