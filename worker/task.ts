/**
 * One background task started from a button on the site (.github/workflows/task.yml): discover, score or prepare.
 * Runs in GitHub Actions, so it is not bound by the website host's 60-second limit. Each task is a recorded run (Logs > Runs).
 *
 * Start with NODE_OPTIONS=--conditions=react-server so the app's "server-only" markers resolve outside Next.js.
 */
import { failStaleRuns, withRun } from "../src/lib/activity";
import { prepareApplication } from "../src/lib/apply/prepare";
import { discoverNow } from "../src/lib/jobs/discover";
import { modelReadiness } from "../src/lib/llm/registry";
import { sendTelegram } from "../src/lib/notify";
import { scoreNewJobs } from "../src/lib/score/run";

const MIN = 60_000;

async function main() {
  const task = (process.env.TASK ?? "").trim();
  await failStaleRuns(30).catch(() => 0);
  const ready = await modelReadiness().catch(() => null);
  if (ready) console.log(ready.usable.length ? `Models ready: ${ready.usable.join(", ")}` : `NO MODEL AVAILABLE: ${ready.message}`);

  if (task === "discover") {
    const found = await discoverNow({ trigger: "manual", budgetMs: 8 * MIN });
    console.log(`Search: ${found.outcomes.length} scan(s), ${found.outcomes.reduce((n, s) => n + s.counts.inserted, 0)} new job(s).`);
    const scored = await scoreNewJobs({ limit: 80, budgetMs: 12 * MIN, trigger: "manual" });
    console.log(JSON.stringify(scored));
    await sendTelegram(`Career Agent: search finished. ${found.outcomes.reduce((n, s) => n + s.counts.inserted, 0)} new job(s); ${scored.scored} scored, ${scored.queued} matched.`).catch(() => undefined);
  } else if (task === "score") {
    const scored = await scoreNewJobs({ limit: 80, budgetMs: 12 * MIN, trigger: "manual" });
    console.log(JSON.stringify(scored));
    await sendTelegram(`Career Agent: scoring finished. ${scored.scored} scored, ${scored.queued} matched, ${scored.remaining} still waiting.`).catch(() => undefined);
  } else if (task === "prepare") {
    const id = (process.env.JOB_ID ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("JOB_ID must be a job id");
    const r = await withRun({ trigger: "manual", kind: "prepare", scope: { job_id: id } }, (ctx) => prepareApplication(id, ctx.id));
    console.log(JSON.stringify(r));
  } else {
    throw new Error(`Unknown task "${task}" (use discover, score or prepare)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
