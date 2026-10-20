import { NextResponse } from "next/server";
import { failStaleRuns } from "@/lib/activity";
import { checkAssistant } from "@/lib/apply/assistant-health";
import { checkStaleSources } from "@/lib/integrations/health-check";
import { isDue } from "@/lib/schedule";
import { healKeys } from "@/lib/llm/keys";
import { listSchedules, seedRecommendedSchedule } from "@/lib/schedule-store";
import { recordTick } from "@/lib/automation-health";
import { deliverDaily } from "@/lib/daily-delivery";
import { backlogCounts } from "@/lib/backlog";
import { drainDecision, type DrainState } from "@/lib/backlog-rules";
import { modelReadiness } from "@/lib/llm/registry";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { automationPaused } from "@/lib/pause";
import { forEachProfile } from "@/lib/profiles-store";

/**
 * The hourly GitHub Actions tick asks this first, so the heavy job (install, models, browser) only starts when a
 * schedule is actually due. Read-only for schedules: the pipeline itself claims them. Also clears runs that died.
 */
export async function GET() {
  // each profile that is switched on is checked on its own (its schedules, backlog, pause switch, morning report); the answers are then combined
  const per = await forEachProfile(async (p) => {
    const swept = await failStaleRuns(30);
    const stale = await checkStaleSources();
    const assistantAlerted = await checkAssistant();
    const listed = await listSchedules();
    const { missing } = listed;
    const seeded = missing ? null : await seedRecommendedSchedule(listed.rows.length).catch(() => null);
    const rows = seeded ? [...listed.rows, seeded] : listed.rows;
    const now = new Date();
    const paused = await automationPaused();
    const due = paused ? [] : rows.filter((s) => isDue(s, now));
    const delivered = await deliverDaily().catch((e) => ({ sent: false, skipped: e instanceof Error ? e.message : String(e) })); // the morning report and health check, once a day
    // between schedules, work through whatever is waiting (scoring first, then resumes for the matches) so a backlog never sits for a day
    const [counts, ready, autoPrepare, stateRow, autopilot] = await Promise.all([backlogCounts().catch(() => ({ unscored: 0, unprepared: 0 })), modelReadiness().catch(() => ({ usable: [] as string[] })), getSetting("auto_prepare"), db().from("settings").select("value").eq("key", "drain_state").maybeSingle(), getSetting("autopilot").catch(() => ({ enabled: false }))]);
    const drain = drainDecision({ ...counts, modelsUsable: ready.usable.length > 0, autoPrepare: autoPrepare.enabled && autoPrepare.per_run > 0, preparingSchedule: rows.some((s) => s.enabled && !s.paused && s.mode !== "scan"), state: (stateRow.data?.value as DrainState) ?? null });
    return {
      profile: p?.name ?? null,
      // Autopilot works every hour whatever is waiting: finishing unfinished searches, scoring, writing, approving; otherwise only when something is backed up
      drain: !paused && due.length === 0 && (drain.drain || !!autopilot.enabled), drainReason: paused ? "Everything is paused (Settings)." : autopilot.enabled ? `Autopilot: hourly round. ${drain.reason}` : drain.reason, paused, backlog: counts, daily: delivered,
      due: due.length, schedules: due.map((s) => s.name), total: rows.length, missing, seeded: !!seeded, swept, staleSources: stale.length, assistantAlerted,
    };
  }, { onError: (p, e) => console.error(`${p ? `[${p.name}] ` : ""}hourly check failed:`, e) });
  const ok = per.flatMap((r) => (r.result ? [r.result] : []));
  const sum = (f: (r: (typeof ok)[number]) => number) => ok.reduce((n, r) => n + f(r), 0);
  const due = sum((r) => r.due);
  await recordTick({ due, total: sum((r) => r.total) });
  const healed = await healKeys().catch(() => 0); // give saved model keys the copy the GitHub runner can read
  const first = ok[0];
  return NextResponse.json({
    drain: ok.some((r) => r.drain), drainReason: ok.map((r) => (r.profile ? `${r.profile}: ` : "") + r.drainReason).join(" | "), paused: ok.length > 0 && ok.every((r) => r.paused),
    backlog: { unscored: sum((r) => r.backlog.unscored), unprepared: sum((r) => r.backlog.unprepared) }, daily: first?.daily, healedKeys: healed, due,
    schedules: ok.flatMap((r) => r.schedules), total: sum((r) => r.total), missing: ok.some((r) => r.missing), seeded: ok.some((r) => r.seeded), swept: sum((r) => r.swept),
    staleSources: sum((r) => r.staleSources), assistantAlerted: ok.some((r) => r.assistantAlerted), profiles: ok.map((r) => ({ profile: r.profile, due: r.due, drain: r.drain })), failedProfiles: per.filter((r) => r.error).map((r) => r.profile?.name ?? null),
  });
}
