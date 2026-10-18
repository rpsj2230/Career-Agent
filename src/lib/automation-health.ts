import "server-only";
import { db } from "@/lib/db";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import { modelReadiness } from "@/lib/llm/registry";
import { getProfile } from "@/lib/profile/store";
import { listSchedules } from "@/lib/schedule-store";
import { getSetting } from "@/lib/settings";
import { workerConfigured } from "@/lib/apply/dispatch";
import { evaluateHealth, worst, type Check } from "./automation-checks";

/** The hourly GitHub check calls this so the app can tell when the clock stops. Never throws. */
export async function recordTick(info: { due: number; total: number }) {
  try { await db().from("settings").upsert({ key: "automation_tick", value: { at: new Date().toISOString(), ...info }, updated_at: new Date().toISOString() }); } catch { /* a courtesy record */ }
}

export async function lastTick(): Promise<string | null> {
  const r = await db().from("settings").select("value").eq("key", "automation_tick").maybeSingle();
  return (r.data?.value as { at?: string } | null)?.at ?? null;
}

/** Gathers the facts and evaluates every check. Each fact is read defensively: a failing read is reported, not thrown. */
export async function automationHealth(now = new Date()): Promise<{ checks: Check[]; status: "ok" | "warn" | "fail" }> {
  const safe = async <T,>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
  const [tickAt, sched, runRow, models, profile, countries, autoapply, newJobs, queued] = await Promise.all([
    safe(lastTick, null),
    safe(() => listSchedules(), { rows: [], missing: false }),
    safe(async () => (await db().from("automation_runs").select("status,started_at,finished_at,error").eq("kind", "pipeline").order("started_at", { ascending: false }).limit(1)).data?.[0] ?? null, null),
    safe(() => modelReadiness(), { usable: [] as string[], unreadable: [] as string[], message: "Could not check the models." }),
    safe(() => getProfile(), null),
    safe(() => loadEffectiveCountries(), { countries: [], configured: false, globalRoles: [] as string[] }),
    safe(() => getSetting("autoapply"), { enabled: false }),
    safe(async () => (await db().from("jobs").select("id", { count: "exact", head: true }).eq("status", "new")).count ?? 0, 0),
    safe(async () => (await db().from("jobs").select("id", { count: "exact", head: true }).eq("status", "queued")).count ?? 0, 0),
  ]);
  const titles = new Set(countries.countries.flatMap((c) => c.titles.map((t) => t.toLowerCase()))).size;
  const checks = evaluateHealth({
    now, tickAt, schedules: sched.rows.map((s) => ({ name: s.name, enabled: s.enabled, paused: s.paused, next_run_at: s.next_run_at })),
    lastPipeline: runRow as never, models: { usable: models.usable.length, message: models.message },
    dispatchConfigured: workerConfigured(), profileReady: !!profile && profile.experience.length > 0, titles, countries: countries.countries.length,
    newJobs, queuedJobs: queued, autoApply: autoapply.enabled,
  });
  return { checks, status: worst(checks) };
}
