/**
 * Scheduled pipeline, run by GitHub Actions (.github/workflows/pipeline.yml).
 * Claims the schedules that are due (or the one named by SCHEDULE_ID for "Run now"), runs each inside a recorded run,
 * records the outcome on the schedule, and tells the workflow how many automated applications are ready to submit.
 *
 * Start with NODE_OPTIONS=--conditions=react-server so the app's "server-only" markers resolve outside Next.js.
 */
import { appendFileSync } from "node:fs";
import { failStaleRuns } from "../src/lib/activity";
import { notifyProfile as notifyTelegram } from "../src/lib/notify-profile";
import { sendTelegram } from "../src/lib/notify";
import { forEachProfile, type Profile } from "../src/lib/profiles-store";
import { profilesEnabled } from "../src/lib/scope";
import { rawClient } from "../src/lib/raw-client";
import { repairGarbledJobs, settleReceiptJobs } from "../src/lib/jobs/repair-store";
import { requeueFailed } from "../src/lib/apply/auto-retry-store";
import { reapStuckApplications } from "../src/lib/apply/reaper";
import { promptPrepared } from "../src/lib/telegram-prompts";
import { trackReplies } from "../src/lib/mail/track";
import { applyRetention } from "../src/lib/jobs/retention";
import { sweepScreenshots } from "../src/lib/apply/screenshot-store";
import { modelReadiness } from "../src/lib/llm/registry";
import { liveDeps } from "../src/lib/pipeline/deps";
import { pipelineSummaryText, runPipeline, type PipelineSummary } from "../src/lib/pipeline/run";
import type { ScheduleRow } from "../src/lib/schedule";
import { claimDueSchedules, getSchedule, listSchedules, recordScheduleRun } from "../src/lib/schedule-store";
import { backlogCounts } from "../src/lib/backlog";
import { drainDecision, type DrainState } from "../src/lib/backlog-rules";
import { db } from "../src/lib/db";
import { getSetting, putSetting } from "../src/lib/settings";
import { AUTOPILOT } from "../src/lib/autopilot";
import { getProfile } from "../src/lib/profile/store";
import { pauseActive } from "../src/lib/pause-rules";

async function runOne(s: ScheduleRow, trigger: "schedule" | "manual"): Promise<PipelineSummary | null> {
  console.log(`== ${s.name} (${s.mode})`);
  try {
    const autopilot = !!(await getSetting("autopilot").catch(() => null))?.enabled;
    const sum = await runPipeline(s, liveDeps(), { trigger, prepareConcurrency: (await getSetting("auto_prepare").catch(() => null))?.concurrency, ...(autopilot ? { approveBacklog: AUTOPILOT.approvePerRound } : {}) });
    await recordScheduleRun(s.id, sum.partial ? "partial" : "succeeded").catch((e) => console.error("could not record the schedule's result:", e));
    await notifyTelegram(pipelineSummaryText(s.name, sum, process.env.APP_URL));
    console.log(JSON.stringify(sum));
    return sum;
  } catch (e) {
    console.error(`Schedule "${s.name}" failed:`, e);
    await recordScheduleRun(s.id, "failed").catch(() => undefined);
    await notifyTelegram(`Career Agent: schedule "${s.name}" failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return null;
  }
}

/** Between schedules: score what is waiting and prepare resumes for the matches, following the rules of your active schedule (so nothing is sent without the approval it asks for). */
async function drainBacklog(): Promise<number> {
  const [counts, autoPrepare, schedules, stateRow, models] = await Promise.all([
    backlogCounts(), getSetting("auto_prepare"), listSchedules(), db().from("settings").select("value").eq("key", "drain_state").maybeSingle(), modelReadiness().catch(() => ({ usable: [] as string[] })),
  ]);
  const active = schedules.rows.filter((s) => s.enabled && !s.paused);
  const preparing = active.find((s) => s.mode !== "scan");
  const state = (stateRow.data?.value as DrainState) ?? null;
  const d = drainDecision({ ...counts, modelsUsable: models.usable.length > 0, autoPrepare: autoPrepare.enabled && autoPrepare.per_run > 0, preparingSchedule: !!preparing, state });
  console.log(`Backlog: ${counts.unscored} to score, ${counts.unprepared} matched without a resume. ${d.reason}`);
  // Autopilot also approves what is prepared and still waiting for a person, even when nothing is left to score or write
  const autopilot = !!(await getSetting("autopilot").catch(() => null))?.enabled;
  const waiting = autopilot ? ((await db().from("applications").select("id", { count: "exact", head: true }).eq("status", "prepared")).count ?? 0) : 0;
  if (autopilot) console.log(`Autopilot: ${waiting} prepared application(s) waiting for approval.`);
  // with Autopilot every hourly round also carries on the search (searches that did not fit in the last round, and any that are due again)
  if (!autopilot && !d.drain && waiting === 0) return 0;
  const sum = await runPipeline({
    id: "backlog", name: "Backlog", countries: [], integrations: [],
    ...(autopilot
      ? { mode: AUTOPILOT.schedule.mode, require_approval: false, max_prepare: autoPrepare.enabled ? autoPrepare.per_run : 0, max_apply: AUTOPILOT.schedule.max_apply }
      : { mode: preparing && autoPrepare.enabled ? preparing.mode : "scan", require_approval: preparing ? preparing.require_approval : true, max_prepare: autoPrepare.enabled ? autoPrepare.per_run : 0, max_apply: preparing?.max_apply ?? 0 }),
  }, liveDeps(), { trigger: "schedule", skipScan: !autopilot, prepareConcurrency: autoPrepare.concurrency, ...(autopilot ? { approveBacklog: AUTOPILOT.approvePerRound } : {}) });
  const progress = sum.inserted + sum.scored + sum.prepared + sum.autoApproved + sum.manualRequired;
  await putSetting("drain_state", { at: new Date().toISOString(), noProgress: progress === 0 ? (state?.noProgress ?? 0) + 1 : 0, last: { scored: sum.scored, matched: sum.matched, prepared: sum.prepared } });
  if (progress > 0) await notifyTelegram(pipelineSummaryText("Backlog cleared a little", sum, process.env.APP_URL)).catch(() => undefined);
  console.log(JSON.stringify(sum));
  return sum.readyToSubmit;
}

/** Everything the pipeline does for one person. Runs inside that profile's context, so nothing it reads or writes can belong to anyone else. */
async function runProfile(p: Profile | null, id: string | undefined): Promise<number> {
  const label = p ? `[${p.name}] ` : "";
  // the pause switch: nothing runs by itself (a schedule you start by hand with "Run this schedule now" still runs)
  if (!id && pauseActive(await getSetting("automation_pause").catch(() => null))) {
    console.log(`${label}Everything is paused (Settings → Pause everything). Nothing was run.`);
    return 0;
  }
  const swept = await failStaleRuns(30);
  if (swept) console.log(`${label}Marked ${swept} stalled run(s) as failed.`);
  const reaped = await reapStuckApplications().catch((e) => { console.error("could not check for stuck applications (not fatal):", e instanceof Error ? e.message : e); return 0; });
  if (reaped) console.log(`${label}Handed back ${reaped} application(s) whose worker stopped before finishing.`);
  // Autopilot: an application whose last attempt failed for a reason a second try can fix goes back in the queue (at most twice)
  if ((await getSetting("autopilot").catch(() => null))?.enabled) {
    const again = await requeueFailed().catch((e) => { console.error("could not retry failed applications (not fatal):", e instanceof Error ? e.message : e); return 0; });
    if (again) console.log(`${label}Put ${again} failed application(s) back in the queue to try again.`);
  }
  const repaired = await repairGarbledJobs().catch((e) => { console.error("could not clean up job text (not fatal):", e instanceof Error ? e.message : e); return 0; });
  if (repaired) console.log(`${label}Cleaned up the company or place of ${repaired} job(s).`);
  const settled = await settleReceiptJobs().catch((e) => { console.error("could not settle receipt jobs (not fatal):", e instanceof Error ? e.message : e); return 0; });
  if (settled) console.log(`${label}Marked ${settled} application(s) as applied: the portal's own receipt email says you already applied.`);
  const replies = await trackReplies();
  if (replies.updated.length) console.log(`${label}Replies: ${replies.updated.map((u) => `${u.company} (${u.reply})`).join(", ")}`);
  // a profile that has not been set up (no confirmed resume yet) has nothing to search with or score against: its schedules wait, they do not fail
  if (!id && !((await getProfile().catch(() => null))?.experience.length)) {
    console.log(`${label}This profile has no confirmed resume yet, so its schedules wait (Profile page: import and confirm it).`);
    return 0;
  }
  let list: ScheduleRow[];
  if (id) {
    const s = await getSchedule(id);
    if (!s) throw new Error(`Schedule ${id} not found`);
    list = [s];
  } else {
    list = await claimDueSchedules();
  }
  console.log(list.length ? `${label}${list.length} schedule(s) to run.` : `${label}Nothing is due.`);
  let ready = 0;
  for (const s of list) ready += (await runOne(s, id ? "manual" : "schedule"))?.readyToSubmit ?? 0;
  if (!list.length && !id) ready += await drainBacklog().catch((e) => { console.error("backlog round failed:", e instanceof Error ? e.message : e); return 0; });
  const prompted = await promptPrepared();
  if (prompted) console.log(`${label}Sent ${prompted} application(s) to Telegram for one-tap approval.`);
  await applyRetention().then((r) => { if (r.trimmed || r.logsDeleted) console.log(`${label}Housekeeping: cleared ${r.trimmed} old skipped description(s), deleted ${r.logsDeleted} old rejection log line(s).`); }).catch((e) => console.error("housekeeping failed (not fatal):", e instanceof Error ? e.message : e));
  await sweepScreenshots().then((r) => { if (r.removed) console.log(`${label}Housekeeping: deleted ${r.removed} picture(s) of ${r.applications} finished application(s).`); }).catch((e) => console.error("picture cleanup failed (not fatal):", e instanceof Error ? e.message : e));
  return ready;
}

async function main() {
  const id = process.env.SCHEDULE_ID?.trim();
  // say up front whether any model can be used here, so "nothing was scored" always has its reason in the log and in Telegram (models are shared by every profile)
  const models = await modelReadiness().catch((e) => ({ usable: [] as string[], unreadable: [] as string[], message: `Could not check the models: ${e instanceof Error ? e.message : e}` }));
  if (models.usable.length) console.log(`Models ready: ${models.usable.join(", ")}`);
  else { console.error(`NO MODEL AVAILABLE: ${models.message}`); await sendTelegram(`Career Agent: ${models.message}`).catch(() => undefined); }
  // "Run now" names a schedule, which belongs to one profile; otherwise every profile that is switched on gets its turn
  let only: string | null = null;
  if (id && (await profilesEnabled(rawClient()))) {
    const { data } = await rawClient().from("schedules").select("profile_id").eq("id", id).maybeSingle();
    if (!data?.profile_id) throw new Error(`Schedule ${id} not found`);
    only = data.profile_id as string;
  }
  const runs = await forEachProfile((p) => runProfile(p, id), { only, onError: (p, e) => { console.error(`${p ? `[${p.name}] ` : ""}pipeline failed:`, e); process.exitCode = 1; } });
  const ready = runs.reduce((n, r) => n + (r.result ?? 0), 0);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ready_to_submit=${ready}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
