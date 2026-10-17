/**
 * Scheduled pipeline, run by GitHub Actions (.github/workflows/pipeline.yml).
 * Claims the schedules that are due (or the one named by SCHEDULE_ID for "Run now"), runs each inside a recorded run,
 * records the outcome on the schedule, and tells the workflow how many automated applications are ready to submit.
 *
 * Start with NODE_OPTIONS=--conditions=react-server so the app's "server-only" markers resolve outside Next.js.
 */
import { appendFileSync } from "node:fs";
import { failStaleRuns } from "../src/lib/activity";
import { sendTelegram as notifyTelegram } from "../src/lib/notify";
import { applyRetention } from "../src/lib/jobs/retention";
import { liveDeps } from "../src/lib/pipeline/deps";
import { pipelineSummaryText, runPipeline, type PipelineSummary } from "../src/lib/pipeline/run";
import type { ScheduleRow } from "../src/lib/schedule";
import { claimDueSchedules, getSchedule, recordScheduleRun } from "../src/lib/schedule-store";

async function runOne(s: ScheduleRow, trigger: "schedule" | "manual"): Promise<PipelineSummary | null> {
  console.log(`== ${s.name} (${s.mode})`);
  try {
    const sum = await runPipeline(s, liveDeps(), { trigger });
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

async function main() {
  const swept = await failStaleRuns(30);
  if (swept) console.log(`Marked ${swept} stalled run(s) as failed.`);
  const id = process.env.SCHEDULE_ID?.trim();
  let list: ScheduleRow[];
  if (id) {
    const s = await getSchedule(id);
    if (!s) throw new Error(`Schedule ${id} not found`);
    list = [s];
  } else {
    list = await claimDueSchedules();
  }
  console.log(list.length ? `${list.length} schedule(s) to run.` : "Nothing is due.");
  let ready = 0;
  for (const s of list) ready += (await runOne(s, id ? "manual" : "schedule"))?.readyToSubmit ?? 0;
  await applyRetention().then((r) => { if (r.trimmed || r.logsDeleted) console.log(`Housekeeping: cleared ${r.trimmed} old skipped description(s), deleted ${r.logsDeleted} old rejection log line(s).`); }).catch((e) => console.error("housekeeping failed (not fatal):", e instanceof Error ? e.message : e));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ready_to_submit=${ready}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
