/**
 * One background task started from a button on the site (.github/workflows/task.yml): discover, score or prepare.
 * Runs in GitHub Actions, so it is not bound by the website host's 60-second limit. Each task is a recorded run (Logs > Runs).
 *
 * Start with NODE_OPTIONS=--conditions=react-server so the app's "server-only" markers resolve outside Next.js.
 */
import { failStaleRuns, withRun } from "../src/lib/activity";
import { prepareApplication } from "../src/lib/apply/prepare";
import { draftInterviewAnswers } from "../src/lib/autofill/draft-answers";
import { discoverNow } from "../src/lib/jobs/discover";
import { callStructured } from "../src/lib/llm/call";
import { withLocalFallback, type ModelRow } from "../src/lib/llm/fallback";
import { buildModel, modelReadiness } from "../src/lib/llm/registry";
import { putSetting } from "../src/lib/settings";
import { JobScore } from "../src/lib/types";
import { sendTelegram } from "../src/lib/notify";
import { notifyProfile } from "../src/lib/notify-profile";
import { forEachProfile } from "../src/lib/profiles-store";
import { profilesEnabled } from "../src/lib/scope";
import { rawClient } from "../src/lib/raw-client";
import { scoreNewJobs } from "../src/lib/score/run";

const MIN = 60_000;

/** Ask the local model one real structured question (the kind scoring asks) and record whether and how fast it answered. */
async function testLocalModel() {
  const model = (process.env.LOCAL_MODEL ?? "").trim();
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";
  const t0 = Date.now();
  let result: { ok: boolean; note: string };
  try {
    if (!model) throw new Error("No local model was configured for this run");
    const row = withLocalFallback([{ label: "ollama-local", provider: "ollama", base_url: "http://127.0.0.1:11434/v1", model, api_key_env: null, tasks: ["score"], priority: 1, enabled: true, daily_cap: null } as unknown as ModelRow], process.env)[0];
    const out = await callStructured(buildModel(row, undefined), {
      schema: JobScore,
      system: "You judge how well a candidate fits a job. Score from 0 to 100.",
      prompt: "CANDIDATE: product manager, 6 years, payments, SQL, A/B testing.\nJOB: Senior Product Manager, Payments. Own the payments roadmap, run experiments, analyse funnels with SQL.\nReturn the fit score, matched skills, gaps and a one-sentence summary.",
      timeoutMs: 8 * MIN,
    });
    const s = out.output;
    result = { ok: Number.isFinite(s.score), note: `Answered a real scoring question: fit ${Math.round(s.score)}, matched ${s.matchedSkills.slice(0, 4).join(", ") || "nothing"}. "${s.summary.slice(0, 120)}"` };
  } catch (e) {
    result = { ok: false, note: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  const ms = Date.now() - t0;
  console.log(`LOCAL MODEL TEST ${result.ok ? "PASSED" : "FAILED"} (${model}, ${ms} ms): ${result.note}`);
  await putSetting("local_model_test", { at: new Date().toISOString(), ok: result.ok, model, ms, note: result.note, run_url: runUrl });
  await sendTelegram(`Career Agent: local model test ${result.ok ? "passed" : "FAILED"} (${model}, ${Math.round(ms / 1000)} s). ${result.note.slice(0, 200)}`).catch(() => undefined);
  if (!result.ok) process.exitCode = 1;
}

async function runTask(task: string) {
  await failStaleRuns(30).catch(() => 0);
  const ready = await modelReadiness().catch(() => null);
  if (ready) console.log(ready.usable.length ? `Models ready: ${ready.usable.join(", ")}` : `NO MODEL AVAILABLE: ${ready.message}`);

  if (task === "localtest") {
    await testLocalModel();
  } else if (task === "write_answers") {
    const r = await draftInterviewAnswers({ budgetMs: 12 * MIN, sequential: true });
    if ("error" in r) throw new Error(r.error);
    console.log(r.note);
    await notifyProfile(`Career Agent: interview answers written. ${r.note}. Open Profile > Answer bank to read and edit them.`).catch(() => undefined);
  } else if (task === "discover") {
    const found = await discoverNow({ trigger: "manual", budgetMs: 8 * MIN });
    console.log(`Search: ${found.outcomes.length} scan(s), ${found.outcomes.reduce((n, s) => n + s.counts.inserted, 0)} new job(s).`);
    const scored = await scoreNewJobs({ limit: 80, budgetMs: 12 * MIN, trigger: "manual" });
    console.log(JSON.stringify(scored));
    await notifyProfile(`Career Agent: search finished. ${found.outcomes.reduce((n, s) => n + s.counts.inserted, 0)} new job(s); ${scored.scored} scored, ${scored.queued} matched.`).catch(() => undefined);
  } else if (task === "score") {
    const scored = await scoreNewJobs({ limit: 80, budgetMs: 12 * MIN, trigger: "manual" });
    console.log(JSON.stringify(scored));
    await notifyProfile(`Career Agent: scoring finished. ${scored.scored} scored, ${scored.queued} matched, ${scored.remaining} still waiting.`).catch(() => undefined);
  } else if (task === "prepare_many") {
    const ids = (process.env.JOB_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new Error("JOB_IDS must be a comma-separated list of job ids");
    let ok = 0, failed = 0;
    for (const id of ids) {
      try { await withRun({ trigger: "manual", kind: "prepare", scope: { job_id: id, bulk: true } }, (ctx) => prepareApplication(id, ctx.id)); ok++; }
      catch (e) { failed++; console.error(`prepare ${id} failed:`, e instanceof Error ? e.message : e); if (e instanceof Error && /No model available|All models failed/.test(e.message)) break; }
    }
    console.log(`Prepared ${ok} of ${ids.length}${failed ? ` (${failed} failed)` : ""}.`);
    await notifyProfile(`Career Agent: prepared ${ok} of ${ids.length} application(s). Open Applications to approve them.`).catch(() => undefined);
  } else if (task === "regenerate") {
    const id = (process.env.JOB_ID ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("JOB_ID must be a job id");
    const r = await withRun({ trigger: "manual", kind: "prepare", scope: { job_id: id, regenerate: true } }, (ctx) =>
      prepareApplication(id, ctx.id, { regenerate: true, guidance: process.env.GUIDANCE ?? "", confirmSubmitted: process.env.CONFIRM === "1" }));
    console.log(JSON.stringify(r));
    await notifyProfile(`Career Agent: a new resume was written for an application${r.verified ? " (verified)" : " (needs your review)"}. Open Applications to approve it.`).catch(() => undefined);
  } else if (task === "prepare") {
    const id = (process.env.JOB_ID ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("JOB_ID must be a job id");
    const r = await withRun({ trigger: "manual", kind: "prepare", scope: { job_id: id } }, (ctx) => prepareApplication(id, ctx.id));
    console.log(JSON.stringify(r));
  } else {
    throw new Error(`Unknown task "${task}" (use discover, score, prepare, prepare_many, regenerate, write_answers or localtest)`);
  }
}

/** The profile a job belongs to, when the task names a job (a button on that job's page). */
async function profileOfJob(): Promise<string | null> {
  const id = (process.env.JOB_ID ?? process.env.JOB_IDS ?? "").split(",")[0]?.trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await rawClient().from("jobs").select("profile_id").eq("id", id).maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}

async function main() {
  const task = (process.env.TASK ?? "").trim();
  // the local model test is about the runner, not a person: it runs without a profile
  if (task === "localtest" || !(await profilesEnabled(rawClient()))) return runTask(task);
  // a button on the site names the profile it was pressed in; a job's own profile is the fallback; otherwise every profile that is switched on
  const only = process.env.PROFILE_ID?.trim() || (await profileOfJob());
  const runs = await forEachProfile(() => runTask(task), { only, onError: (p, e) => { console.error(`${p ? `[${p.name}] ` : ""}${task} failed:`, e); process.exitCode = 1; } });
  if (only && runs.length === 0) throw new Error("That profile does not exist");
}

main().catch((e) => { console.error(e); process.exit(1); });
