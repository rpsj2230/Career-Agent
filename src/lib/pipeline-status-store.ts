import "server-only";
import { assistantStatus } from "@/lib/apply/assistant-health";
import { workerConfigured } from "@/lib/apply/dispatch";
import { loadCapState } from "@/lib/apply/state";
import { lastTick } from "@/lib/automation-health";
import { db } from "@/lib/db";
import { modelHealth, type Call } from "@/lib/llm/health";
import { modelReadiness } from "@/lib/llm/registry";
import { explainPipeline, type PipelineInput } from "@/lib/pipeline-status";
import { listSchedules } from "@/lib/schedule-store";
import { getSetting } from "@/lib/settings";

/** Reads every fact the explanation needs. Each read is defensive: a failing read shows as "unknown", never as a broken page. */
export async function loadPipelineStatus(now = new Date()) {
  const safe = async <T,>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
  const head = async (table: "jobs" | "applications", status: string) => safe(async () => (await db().from(table).select("id", { count: "exact", head: true }).eq("status", status)).count ?? 0, 0);

  const [jobStatuses, appStatuses] = await Promise.all([
    Promise.all((["new", "queued", "saved", "prepared", "applied", "skipped"] as const).map(async (s) => [s, await head("jobs", s)] as const)),
    Promise.all((["prepared", "approved", "submitting", "assisted_pending", "needs_input", "failed", "submitted"] as const).map(async (s) => [s, await head("applications", s)] as const)),
  ]);
  const jobs = Object.fromEntries(jobStatuses) as PipelineInput["jobs"];
  const apps = Object.fromEntries(appStatuses) as PipelineInput["apps"];

  const [readiness, autoPrepare, autoapply, caps, pause, sched, tickAt, lastRun, drainRow, assistant, capState, oldest] = await Promise.all([
    safe(() => modelReadiness(), { usable: [] as string[], unreadable: [] as string[], message: "Could not check the models." as string | null, envOnly: [] as string[], stored: [] as string[] }),
    safe(() => getSetting("auto_prepare"), { enabled: true, per_run: 15, concurrency: 3 } as { enabled: boolean; per_run: number; concurrency?: number }),
    safe(() => getSetting("autoapply"), { enabled: false }),
    safe(() => getSetting("caps"), { daily_total: 15, local_auto_enabled: false } as { daily_total: number; local_auto_enabled?: boolean }),
    safe(() => getSetting("automation_pause"), { paused: false, since: "", note: "" }),
    safe(() => listSchedules(), { rows: [], missing: false }),
    safe(() => lastTick(), null),
    safe(async () => (await db().from("automation_runs").select("status,started_at,error").eq("kind", "pipeline").order("started_at", { ascending: false }).limit(1)).data?.[0] ?? null, null),
    safe(async () => (await db().from("settings").select("value").eq("key", "drain_state").maybeSingle()).data?.value ?? null, null),
    safe(() => assistantStatus(now), null),
    safe(() => loadCapState(), { automatedToday: 0, linkedinAutomatedToday: 0, linkedinAutomatedThisWeek: 0 }),
    safe(async () => (await db().from("applications").select("approved_at").in("status", ["approved", "submitting"]).order("approved_at", { ascending: true }).limit(1)).data?.[0]?.approved_at ?? null, null as string | null),
  ]);

  // can the AI models be used right now, and are they failing or out of allowance?
  const usableLabels = readiness.usable;
  let allFailing = false, allAtLimit = false, lastError: string | null = null;
  if (usableLabels.length > 0) {
    const midnight = new Date(now); midnight.setUTCHours(0, 0, 0, 0);
    // today's calls are counted by the database, not read row by row (a busy day has thousands of rows)
    const count = (label: string, ok: boolean) => safe(async () => (await db().from("model_usage").select("id", { count: "exact", head: true }).eq("model_label", label).eq("ok", ok).gte("created_at", midnight.toISOString())).count ?? 0, 0);
    const [cfg, recent, todayCounts] = await Promise.all([
      safe(async () => (await db().from("model_configs").select("label,daily_cap").in("label", usableLabels)).data ?? [], [] as { label: string; daily_cap: number | null }[]),
      safe(async () => (await db().from("model_usage").select("model_label,ok,error,created_at").in("model_label", usableLabels).order("created_at", { ascending: false }).limit(400)).data ?? [], [] as { model_label: string; ok: boolean; error: string | null; created_at: string }[]),
      Promise.all(usableLabels.map(async (label) => ({ label, ok: await count(label, true), bad: await count(label, false) }))),
    ]);
    const health = usableLabels.map((label) => {
      const c = cfg.find((x) => x.label === label);
      const calls: Call[] = recent.filter((r) => r.model_label === label).slice(0, 20).map((r) => ({ ok: r.ok, error: r.error, at: r.created_at }));
      const t = todayCounts.find((x) => x.label === label);
      const todayOk = t?.ok ?? 0;
      return { label, cap: c?.daily_cap ?? null, todayOk, h: modelHealth({ enabled: true, keyed: true, todayOk, todayBad: t?.bad ?? 0, dailyCap: c?.daily_cap ?? null, calls }) };
    });
    allAtLimit = health.every((x) => x.cap !== null && x.todayOk >= x.cap);
    allFailing = !allAtLimit && health.every((x) => x.h.status === "failing");
    lastError = health.map((x) => x.h.lastError).find((e): e is string => !!e) ?? null;
  }

  const active = sched.rows.filter((s) => s.enabled && !s.paused);
  const preparing = active.filter((s) => s.mode !== "scan");
  const input: PipelineInput = {
    now, jobs, apps, oldestSending: oldest,
    models: { usable: readiness.stored.length + readiness.envOnly.length > 0 ? usableLabels.length : 0, message: readiness.message, allFailing, allAtLimit, lastError },
    paused: !!pause.paused, autoApply: !!autoapply.enabled,
    autoPrepare: { enabled: !!autoPrepare.enabled, per_run: autoPrepare.per_run ?? 0, concurrency: autoPrepare.concurrency ?? 3 },
    caps: { daily_total: caps.daily_total ?? 15, local_auto_enabled: !!caps.local_auto_enabled },
    automatedToday: capState.automatedToday,
    schedules: { active: active.length, preparing: preparing.length > 0, requireApproval: preparing.length > 0 && preparing.every((s) => s.require_approval), nextRunAt: active.map((s) => s.next_run_at).filter((x): x is string => !!x).sort()[0] ?? null },
    dispatchConfigured: workerConfigured(), tickAt, lastPipeline: lastRun as PipelineInput["lastPipeline"],
    drain: drainRow && typeof drainRow === "object" && "noProgress" in drainRow ? (drainRow as { noProgress: number; at: string }) : null,
    assistant,
  };
  return { input, ...explainPipeline(input) };
}
