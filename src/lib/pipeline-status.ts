import { ago } from "./automation-checks";

/**
 * Where every job stands, how much of each step is done, and WHY the rest is waiting, in plain words.
 * Pure (no database, no network) so every rule is tested; src/lib/pipeline-status-store.ts gathers the facts.
 *
 * Why something waits is always one of:
 *   model   an AI model cannot be used (no key, failing, or its free allowance is used up)
 *   server  the background machinery (GitHub, the hourly check, the apply worker, your computer's assistant) is not running or failed
 *   setting a switch or choice in Settings/Schedules keeps it from moving
 *   limit   a daily or per-round limit has been reached
 *   you     it is waiting for your decision or input
 *   normal  nothing is wrong: it is being worked through at its normal pace
 */
export type Cause = "model" | "server" | "setting" | "limit" | "you" | "normal";
export type Reason = { cause: Cause; text: string; fix?: string; href?: string };
export type StageId = "score" | "resume" | "approve" | "send" | "attention";
export type StageState = "clear" | "flowing" | "blocked" | "you";
export type Stage = { id: StageId; title: string; question: string; waiting: number; done: number; pct: number | null; state: StageState; reasons: Reason[]; href: string };

export type PipelineInput = {
  now: Date;
  jobs: { new: number; queued: number; saved: number; prepared: number; applied: number; skipped: number };
  apps: { prepared: number; approved: number; submitting: number; assisted_pending: number; needs_input: number; failed: number; submitted: number };
  /** when the oldest application that is approved or sending was approved */
  oldestSending: string | null;
  models: { usable: number; message: string | null; allFailing: boolean; allAtLimit: boolean; lastError: string | null };
  paused: boolean;
  autoApply: boolean;
  autoPrepare: { enabled: boolean; per_run: number; concurrency: number };
  caps: { daily_total: number; local_auto_enabled: boolean };
  automatedToday: number;
  schedules: { active: number; preparing: boolean; requireApproval: boolean; nextRunAt: string | null };
  dispatchConfigured: boolean;
  tickAt: string | null;
  lastPipeline: { status: string; started_at: string; error: string | null } | null;
  drain: { noProgress: number; at: string } | null;
  assistant: { relevant: boolean; offline: boolean; text: string } | null;
};

const HOUR = 3_600_000;
const pct = (done: number, waiting: number): number | null => (done + waiting > 0 ? Math.round((done / (done + waiting)) * 100) : null);
const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

/** Why background work (scoring, writing resumes) is not moving, if it is not. Shared by the steps that depend on it. */
function workBlockers(i: PipelineInput): Reason[] {
  const out: Reason[] = [];
  if (i.paused) out.push({ cause: "setting", text: "Everything is paused (Settings, Pause everything). Nothing runs by itself.", fix: "Switch Pause everything off.", href: "/settings" });
  if (i.models.usable === 0) out.push({ cause: "model", text: i.models.message ?? "No AI model has a usable key.", fix: "Add a key on the Models page and press Test.", href: "/models" });
  else if (i.models.allAtLimit) out.push({ cause: "limit", text: "Every AI model has used its free allowance for today. Work continues after midnight (UTC) or as soon as you add another model or key.", fix: "Add more models or keys.", href: "/models" });
  else if (i.models.allFailing) out.push({ cause: "model", text: `Every usable AI model failed its recent calls${i.models.lastError ? `: ${i.models.lastError.slice(0, 140)}` : ""}.`, fix: "Open the Models page: the Errors column and Test button show which and why.", href: "/models" });
  if (!i.dispatchConfigured) out.push({ cause: "server", text: "GitHub is not connected to the app, so nothing can run in the background.", fix: "System health: add GITHUB_REPO and GITHUB_DISPATCH_TOKEN.", href: "/system" });
  const tickAge = i.tickAt ? i.now.getTime() - new Date(i.tickAt).getTime() : Infinity;
  if (i.dispatchConfigured && tickAge > 6 * HOUR) out.push({ cause: "server", text: `The hourly GitHub check has not reached the app ${i.tickAt ? `since ${ago(i.tickAt, i.now)}` : "yet"}.`, fix: "GitHub, Actions, Scheduled pipeline: look at the latest run and press Run workflow once.", href: "/system" });
  if (i.lastPipeline && /fail/i.test(i.lastPipeline.status)) out.push({ cause: "server", text: `The last automatic run failed ${ago(i.lastPipeline.started_at, i.now)}${i.lastPipeline.error ? `: ${i.lastPipeline.error.slice(0, 140)}` : ""}.`, fix: "Logs & history shows the run and its error.", href: "/logs/runs" });
  if (i.schedules.active === 0) out.push({ cause: "setting", text: "No schedule is switched on, so there are no automatic rounds.", fix: "Schedules: switch one on (or press Run now).", href: "/schedules" });
  if (i.drain && i.drain.noProgress >= 2 && i.now.getTime() - new Date(i.drain.at).getTime() < 6 * HOUR) out.push({ cause: "model", text: "The last backlog rounds made no progress (usually every AI call failed), so it is pausing for a few hours before trying again.", fix: "Fix the models first (Models page), then press Run now on Schedules.", href: "/models" });
  return out;
}

export function explainPipeline(i: PipelineInput): { stages: Stage[]; blocked: number; headline: string } {
  const j = i.jobs, a = i.apps;
  const blockers = workBlockers(i);
  const stages: Stage[] = [];

  // 1. scoring
  {
    const waiting = j.new, done = j.queued + j.saved + j.prepared + j.applied + j.skipped;
    const reasons: Reason[] = waiting === 0 ? [] : [...blockers];
    if (waiting > 0 && blockers.length === 0) reasons.push({ cause: "normal", text: `Being scored automatically, about 60 jobs per round: roughly ${Math.max(1, Math.ceil(waiting / 60))} round${Math.ceil(waiting / 60) === 1 ? "" : "s"} for ${plural(waiting, "job")}.${i.schedules.nextRunAt ? "" : " A new round starts as soon as the last one ends."}` });
    stages.push({ id: "score", title: "Scoring", question: "Found jobs scored against your profile", waiting, done, pct: pct(done, waiting), state: waiting === 0 ? "clear" : blockers.length ? "blocked" : "flowing", reasons, href: "/jobs?stage=unscored" });
  }

  // 2. resume
  {
    const waiting = j.queued, done = j.prepared + j.applied;
    const reasons: Reason[] = [];
    if (waiting > 0) {
      if (!i.autoPrepare.enabled || i.autoPrepare.per_run === 0) reasons.push({ cause: "setting", text: "Automatic preparing is switched off, so resumes are only written when you press Prepare.", fix: "Settings, Automatic preparing: switch it on.", href: "/settings" });
      else if (!i.schedules.preparing && i.schedules.active > 0) reasons.push({ cause: "setting", text: "Your active schedule only searches and scores (its mode is ‘scan’), so it never writes resumes.", fix: "Schedules: choose a mode that also prepares.", href: "/schedules" });
      reasons.push(...blockers);
      if (reasons.length === 0) {
        const rounds = Math.max(1, Math.ceil(waiting / Math.max(1, i.autoPrepare.per_run)));
        reasons.push({ cause: "normal", text: `Being written automatically: up to ${i.autoPrepare.per_run} per round, ${i.autoPrepare.concurrency} at a time, so about ${rounds} round${rounds === 1 ? "" : "s"} for ${plural(waiting, "match", "matches")}.` });
      }
    }
    const hard = reasons.some((r) => r.cause !== "normal");
    stages.push({ id: "resume", title: "Resume and cover letter", question: "Matched jobs with a resume written", waiting, done, pct: pct(done, waiting), state: waiting === 0 ? "clear" : hard ? "blocked" : "flowing", reasons, href: "/jobs?stage=matched" });
  }

  // 3. approval
  {
    const waiting = a.prepared, done = a.approved + a.submitting + a.assisted_pending + a.needs_input + a.failed + a.submitted;
    const reasons: Reason[] = [];
    if (waiting > 0) {
      if (!i.autoApply) reasons.push({ cause: "you", text: "Auto-Apply is off, so every application waits for your approval (your approvals, by button or Telegram, always work).", fix: "Approve them, or switch Auto-Apply on in Settings.", href: "/applications?stage=awaiting_approval" });
      else if (i.schedules.requireApproval) reasons.push({ cause: "you", text: "Your schedule is set to ask you before applying.", fix: "Approve them, or change the schedule to apply by itself.", href: "/applications?stage=awaiting_approval" });
      else reasons.push({ cause: "normal", text: "Auto-Apply is on: the next scheduled run approves what the rules allow. Anything it leaves (unverified claims, same-company cooldown, apply limits) stays here for you.", href: "/applications?stage=awaiting_approval" });
      if (i.autoApply && i.automatedToday >= i.caps.daily_total) reasons.push({ cause: "limit", text: `Today's limit of ${i.caps.daily_total} automatic applications is reached (${i.automatedToday} sent). The rest wait until tomorrow or for you to approve.`, fix: "Raise the limit in Settings, Application limits, or approve by hand.", href: "/settings" });
      if (i.paused) reasons.push({ cause: "setting", text: "Everything is paused, so schedules do not approve anything.", href: "/settings" });
    }
    const hard = reasons.some((r) => ["model", "server", "setting", "limit"].includes(r.cause));
    stages.push({ id: "approve", title: "Approval", question: "Prepared applications you or the schedule have decided on", waiting, done, pct: pct(done, waiting), state: waiting === 0 ? "clear" : hard ? "blocked" : reasons.some((r) => r.cause === "you") ? "you" : "flowing", reasons, href: "/applications?stage=awaiting_approval" });
  }

  // 4. sending
  {
    const inFlight = a.approved + a.submitting, assist = a.assisted_pending;
    const waiting = inFlight + assist, done = a.submitted;
    const reasons: Reason[] = [];
    if (inFlight > 0) {
      const age = i.oldestSending ? i.now.getTime() - new Date(i.oldestSending).getTime() : 0;
      if (!i.dispatchConfigured) reasons.push({ cause: "server", text: `${plural(inFlight, "application")} approved for the cloud, but GitHub is not connected, so the next scheduled run sends them.`, fix: "System health: connect GitHub.", href: "/system" });
      else if (age > 30 * 60_000) reasons.push({ cause: "server", text: `${plural(inFlight, "application")} approved or sending for ${ago(i.oldestSending, i.now).replace(" ago", "")}. The apply worker may have stopped; it hands an application back after 30 minutes.`, fix: "GitHub, Actions: check the latest Apply run.", href: "/system" });
      else reasons.push({ cause: "normal", text: `${plural(inFlight, "application")} being sent from the cloud now (usually under 10 minutes).` });
    }
    if (assist > 0) {
      if (i.assistant?.offline) reasons.push({ cause: "server", text: i.assistant.text, fix: "On your computer: npm run assist:watch (or the autostart).", href: "/applications?stage=waiting_assistant" });
      else if (!i.caps.local_auto_enabled) reasons.push({ cause: "setting", text: `${plural(assist, "application")} are LinkedIn/Naukri/Indeed-type (or beyond a limit): the assistant fills the form, then waits for YOU to press Submit because Hands-free is off.`, fix: "Settings: switch Hands-free on, or submit them yourself.", href: "/settings" });
      else reasons.push({ cause: "normal", text: `${plural(assist, "application")} queued for the assistant on your computer; it works through them within your daily limits and pauses at any security check.`, href: "/applications?stage=waiting_assistant" });
    }
    stages.push({ id: "send", title: "Sending", question: "Approved applications actually sent", waiting, done, pct: pct(done, waiting), state: waiting === 0 ? "clear" : reasons.some((r) => ["model", "server", "setting", "limit"].includes(r.cause)) ? "blocked" : "flowing", reasons, href: "/applications?stage=in_progress" });
  }

  // 5. needs attention
  {
    const waiting = a.needs_input + a.failed;
    const reasons: Reason[] = [];
    if (a.needs_input > 0) reasons.push({ cause: "you", text: `${plural(a.needs_input, "application")} need an answer or a decision from you (a question the form asked that your profile cannot answer, or a security check).`, fix: "Open it, add the answer, then approve again.", href: "/applications?stage=needs_input" });
    if (a.failed > 0) reasons.push({ cause: "server", text: `${plural(a.failed, "application")} failed to send. The reason is on each application (a closed posting, a changed form, a portal block).`, fix: "Open one: Apply again with the same resume, or write a new one.", href: "/applications?stage=failed" });
    stages.push({ id: "attention", title: "Needs you", question: "Hand-backs and failures", waiting, done: 0, pct: null, state: waiting === 0 ? "clear" : "you", reasons, href: "/applications?stage=needs_input" });
  }

  const blocked = stages.filter((s) => s.state === "blocked").length;
  const you = stages.filter((s) => s.state === "you").length;
  const headline = blocked > 0 ? `${blocked} step${blocked === 1 ? " is" : "s are"} blocked: see the reason under each.` : you > 0 ? "Nothing is stuck. The rest is waiting for you." : stages.every((s) => s.state === "clear") ? "Everything is up to date." : "Everything is flowing. Nothing is blocked.";
  return { stages, blocked, headline };
}
