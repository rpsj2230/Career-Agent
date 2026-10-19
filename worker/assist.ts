/**
 * Apply assistant. Runs on YOUR computer, in a real browser window that uses your own signed-in sessions, so it works on the
 * portals that cannot be automated from a server (LinkedIn, Naukri, Indeed, Foundit, Shine, Glassdoor and any employer site).
 *
 *   npm run assist
 *
 * For every application waiting for you ("assisted") it opens the posting, opens the application form, fills in everything it
 * can from the prepared package (your tailored resume, cover letter and saved answers), and then STOPS. You review the form,
 * press the portal's own Submit button, and the application is recorded. It never presses Submit, never handles a password
 * (you sign in yourself, once; the browser keeps the session in a local profile folder), and when a CAPTCHA or security check
 * appears it waits for you to deal with it.
 *
 * Hands-free mode (switch it on in Settings, then run `npm run assist:auto`, or `npm run assist:watch` to keep it running in
 * the background): it also presses Submit itself, but only within your daily limits, only when every required question was
 * answered, only after a pause that looks like a person, and it stops at the first CAPTCHA or security check.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { createInterface } from "node:readline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { scopedDb } from "../src/lib/scoped-db";
import { browserFromMachine, PLAIN_HTTP } from "./browser";
import { chromium, type BrowserContext, type Page } from "playwright";
import { confirmationSnippet, type FieldEntry, type SubmissionRecord } from "../src/lib/apply/submission";
import { MasterProfile } from "../src/lib/types";
import { finalStepVisible, nextStep, openApplyForm } from "./assist-lib";
import { requestPending, type AssistantRequest } from "../src/lib/apply/assistant-request";
import { autoDecision, humanPause, withinHours, type AutoCaps, type AutoState } from "./assist-policy";
import { clickSubmit, fillForm } from "./form";
import { CONFIRMATION, detectBlock, type Answer } from "./match";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set. Put it in .env.local (see the README, "Apply assistant").`); return v; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const rl = createInterface({ input: process.stdin, output: process.stdout });
/** A prompt that can be cancelled (when the page's own confirmation arrives first), so no stale prompt is left waiting. */
const ask = (q: string, signal?: AbortSignal) => new Promise<string>((resolve) => {
  if (signal?.aborted) return resolve("");
  rl.question(q, { signal }, (a) => resolve(a.trim().toLowerCase()));
  signal?.addEventListener("abort", () => resolve(""), { once: true });
});
const say = (s: string) => console.log(s);
const AUTO = process.env.ASSIST_MODE === "auto";
const WATCH = process.env.ASSIST_WATCH === "1";

/** Tell the app this assistant is alive, so it can warn you if applications are waiting and it has gone quiet. Never throws. */
async function heartbeat(sb: SupabaseClient) {
  try {
    await sb.from("settings").upsert({ key: "assistant_heartbeat", value: { at: new Date().toISOString(), mode: AUTO ? "hands-free" : "assist", watching: WATCH, hours: process.env.ASSIST_HOURS ?? "", tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, updated_at: new Date().toISOString() });
  } catch { /* the heartbeat is a courtesy, never a reason to stop */ }
}

/** The global Auto-Apply switch (Settings > Auto-Apply). Missing or unreadable counts as off. */
async function autoApplyOn(sb: SupabaseClient): Promise<boolean> {
  const { data } = await sb.from("settings").select("value").eq("key", "autoapply").maybeSingle();
  return (data?.value as { enabled?: boolean } | null)?.enabled === true;
}

async function loadCaps(sb: SupabaseClient): Promise<AutoCaps> {
  const { data } = await sb.from("settings").select("value").eq("key", "caps").maybeSingle();
  return { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false, local_auto_enabled: false, ...((data?.value as object) ?? {}) };
}
/** What has already been sent automatically (from this or any other machine), for the limits. */
async function loadAutoState(sb: SupabaseClient): Promise<AutoState> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await sb.from("applications").select("submitted_at, portal").eq("method", "automated").eq("status", "submitted").gte("submitted_at", weekAgo);
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const rows = (data ?? []) as { submitted_at: string; portal: string | null }[];
  const today = rows.filter((r) => new Date(r.submitted_at) >= midnight);
  return { submittedToday: today.length, linkedinToday: today.filter((r) => r.portal === "linkedin").length, linkedinThisWeek: rows.filter((r) => r.portal === "linkedin").length };
}

async function logAct(sb: SupabaseClient, e: Record<string, unknown>) {
  try { await sb.from("activity_log").insert({ level: "info", detail: {}, ...e }); } catch { /* the log never changes the outcome */ }
}

type AppRow = { id: string; job_id: string; resume_doc_id: string | null; cover_doc_id: string | null; answers: Answer[] | null };

async function downloadDocs(sb: SupabaseClient, app: AppRow, dir: string) {
  const { data: docs } = await sb.from("documents").select("id,kind,storage_path").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean) as string[]);
  const get = async (kind: string, name: string) => {
    const d = docs?.find((x) => x.kind === kind);
    if (!d?.storage_path) return undefined;
    const { data, error } = await sb.storage.from("documents").download(d.storage_path);
    if (error || !data) throw new Error(`Could not download the ${kind}: ${error?.message}`);
    const file = join(dir, name);
    writeFileSync(file, Buffer.from(await data.arrayBuffer()));
    return { path: file, storage_path: d.storage_path as string };
  };
  const ext = (kind: string) => extname(docs?.find((x) => x.kind === kind)?.storage_path ?? "") || ".docx";
  return { resume: await get("resume", `Resume${ext("resume")}`), cover: await get("cover_letter", `Cover-Letter${ext("cover_letter")}`) };
}

/** Wait until you deal with a sign-in, CAPTCHA or security check in the browser window. */
async function waitForHuman(page: Page, what: string) {
  say(`\n  ${what}\n  Do it in the browser window, then press Enter here.`);
  await ask("  ");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function blocked(page: Page) {
  const captcha = (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').count().catch(() => 0)) > 0;
  const body = await page.innerText("body").catch(() => "");
  return detectBlock(page.url(), body, captcha);
}

type Outcome = "done" | "later" | "skipped" | "quit" | "stop";
class Handback extends Error {
  constructor(message: string, public stopAll = false) { super(message); }
}

/** One application: open it, fill it, then either wait for you (assist) or press Submit within the limits (hands-free). */
async function assistOne(sb: SupabaseClient, context: BrowserContext, app: AppRow, i: number, total: number, auto: { caps: AutoCaps; state: AutoState } | null): Promise<Outcome> {
  const { data: job } = await sb.from("jobs").select("*").eq("id", app.job_id).single();
  if (!job) { say("  (job missing, skipped)"); return "later"; }
  say(`\n[${i}/${total}] ${job.title} at ${job.company}  (${job.portal ?? job.source})\n  ${job.url}`);

  if (auto) {
    const d = autoDecision(job.portal, auto.caps, auto.state);
    if (!d.go) { say(`  Left for later: ${d.reason}.`); return "later"; }
  }

  const { data: profileRow } = await sb.from("profile").select("data").eq("id", 1).single();
  const profile = MasterProfile.parse(profileRow?.data ?? {});
  const dir = mkdtempSync(join(tmpdir(), "assist-"));
  const files = await downloadDocs(sb, app, dir);
  if (!files.resume) { say("  No prepared resume for this application; skipped."); return "later"; }
  const fctx = {
    applicant: { name: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone, location: profile.basics.location, links: profile.basics.links, currentCompany: profile.experience[0]?.company },
    answers: app.answers ?? [], resumePath: files.resume.path, coverPath: files.cover?.path,
  };

  const startedAt = new Date().toISOString();
  const entered: FieldEntry[] = [];
  const unanswered: string[] = [];
  let steps = 0;
  let page = await context.newPage();
  const before = new Set(context.pages());
  const fileInfo = (role: "resume" | "cover_letter", f: { path: string; storage_path: string }) => ({ role, name: basename(f.path), bytes: statSync(f.path).size, sha256: sha256(f.path), storage_path: f.storage_path });
  const record = (outcome: SubmissionRecord["outcome"], method: "assisted" | "automated", confirmation: SubmissionRecord["confirmation"], error: string | null, note: string): SubmissionRecord => ({
    version: 1, method, outcome, started_at: startedAt, finished_at: new Date().toISOString(), target_url: job.url, final_url: page.isClosed() ? null : page.url(),
    fields: entered, files: [fileInfo("resume", files.resume!), ...(files.cover ? [fileInfo("cover_letter", files.cover)] : [])], unanswered, confirmation, error, steps, note,
  });
  const screenshot = async (name: string) => {
    try { const path = `screenshots/${app.id}/${name}.png`; await sb.storage.from("documents").upload(path, await page.screenshot({ fullPage: true }), { contentType: "image/png", upsert: true }); return path; } catch { return null; }
  };
  const submitted = async (method: "assisted" | "automated", confirmed: boolean, note: string) => {
    const text = await page.innerText("body").catch(() => "");
    const shot = await screenshot("confirmation");
    const now = new Date();
    const rec = record("submitted", method, confirmed || CONFIRMATION.test(text) ? { text: confirmationSnippet(text, CONFIRMATION), screenshot: shot } : null, null, note);
    const patch = { status: "submitted", method, submitted_at: now.toISOString(), lifecycle: "applied", screenshot_path: shot };
    const { error } = await sb.from("applications").update({ ...patch, submission: rec }).eq("id", app.id);
    if (error) await sb.from("applications").update(patch).eq("id", app.id);
    await sb.from("jobs").update({ status: "applied" }).eq("id", job.id);
    await sb.from("apply_events").insert({ application_id: app.id, kind: method === "automated" ? "submitted_hands_free" : "submitted_with_assistant", detail: { fields: entered.length } });
    await logAct(sb, { kind: "application.submitted", message: `${method === "automated" ? "Submitted automatically by the apply assistant" : "Submitted by you with the apply assistant"}: ${job.title} at ${job.company}`, status: "submitted", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { method, assistant: true, fields: entered.length } });
  };
  /** Unattended and stuck: say exactly why and leave it for you. */
  const handBack = async (message: string) => {
    const shot = await screenshot("last-state");
    const patch = { status: "needs_input", error: message, screenshot_path: shot };
    const { error } = await sb.from("applications").update({ ...patch, submission: record("needs_input", "automated", null, message, "The apply assistant stopped and handed this back to you.") }).eq("id", app.id);
    if (error) await sb.from("applications").update(patch).eq("id", app.id);
    await sb.from("apply_events").insert({ application_id: app.id, kind: "needs_input", detail: { message } });
    await logAct(sb, { kind: "application.needs_input", level: "warn", message: `Needs you: ${message}`, status: "needs_input", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { assistant: true, message } });
    say(`  Handed back to you: ${message}`);
  };

  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    for (let attempt = 0; attempt < 3; attempt++) {
      const b = await blocked(page);
      if (!b) break;
      if (auto) throw new Handback(b === "login" ? "The portal asked for a sign-in: open the assistant once without hands-free mode and sign in" : b === "captcha" ? "The page shows a CAPTCHA; please do this one yourself" : "The portal shows a security check; automatic applying was stopped for safety", b === "checkpoint");
      await waitForHuman(page, b === "login" ? "This portal wants you to sign in." : b === "captcha" ? "There is a CAPTCHA." : "The portal shows a security check.");
    }
    const opened = await openApplyForm(page);
    const fresh = context.pages().filter((p) => !before.has(p) && p !== page);
    if (fresh.length) page = fresh[fresh.length - 1]; // the apply button opened a new tab
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await sleep(1200);
    if (opened === "none" && !auto) say("  No apply button found on this page. The form may be on the employer's site: use the open window.");

    for (let step = 0; step < 8; step++) {
      const r = await fillForm(page, fctx);
      entered.push(...r.entries); steps++;
      for (const u of r.unanswered) if (!unanswered.includes(u)) unanswered.push(u);
      if (await finalStepVisible(page)) break;
      if (!(await nextStep(page))) break;
      await sleep(900);
    }
  } catch (e) {
    if (e instanceof Handback) { await handBack(e.message); await page.close().catch(() => undefined); return e.stopAll ? "stop" : "later"; }
    if (auto) { await handBack(`Could not prepare the page automatically (${e instanceof Error ? e.message.split("\n")[0] : e})`); await page.close().catch(() => undefined); return "later"; }
    say(`  Could not finish preparing this page automatically (${e instanceof Error ? e.message.split("\n")[0] : e}). The window is open: you can still complete it by hand.`);
  }

  say(`  Filled ${entered.length} field(s) from your package.`);
  if (unanswered.length) say(`  Needs you: ${unanswered.join("; ")}`);

  // ---- hands-free: press Submit only when everything required was answered, then check the portal confirmed it
  if (auto) {
    let problem: string | null = null;
    if (unanswered.length) problem = `Needs you: ${unanswered.join("; ")}`;
    else if (entered.length === 0) problem = "No application form was found on this page (it may need a sign-in, or the role may be closed); apply on the employer's site";
    else if (!(await finalStepVisible(page))) problem = "Could not reach the final step of the form";
    if (problem) { await handBack(problem); await page.close().catch(() => undefined); return "later"; }
    const baseline = CONFIRMATION.test(await page.innerText("body").catch(() => ""));
    if (!(await clickSubmit(page))) { await handBack("Could not find the submit button"); await page.close().catch(() => undefined); return "later"; }
    const ok = await page.waitForFunction(({ src, needFormGone }) => {
      if (!new RegExp(src, "i").test(document.body.innerText)) return false;
      if (!needFormGone) return true;
      return ![...document.querySelectorAll("form input:not([type=hidden]), form textarea, form select")].some((el) => (el as HTMLElement).offsetParent !== null);
    }, { src: CONFIRMATION.source, needFormGone: baseline }, { timeout: 25_000 }).then(() => true, () => false);
    if (!ok) { await handBack("Pressed submit, but no confirmation message was detected; check your email or the portal before retrying"); await page.close().catch(() => undefined); return "later"; }
    await submitted("automated", true, "Submitted automatically by the apply assistant running on your computer, within your daily limits.");
    auto.state.submittedToday++;
    if (job.portal === "linkedin") { auto.state.linkedinToday++; auto.state.linkedinThisWeek++; }
    say("  Submitted and confirmed by the portal.");
    await page.close().catch(() => undefined);
    return "done";
  }

  // ---- assist: wait for you. The page's confirmation message also counts, so you need only press Submit.
  say("  Review the form in the browser window, then press the portal's own Submit button yourself.");
  const confirmed = new Promise<"detected">((resolve) => {
    const poll = async () => {
      for (;;) {
        await sleep(2000);
        if (page.isClosed()) return;
        const text = await page.innerText("body").catch(() => "");
        const formOpen = await page.locator('form input:not([type=hidden]), form textarea').evaluateAll((els) => els.some((e) => (e as HTMLElement).offsetParent !== null)).catch(() => true);
        if (CONFIRMATION.test(text) && !formOpen) { resolve("detected"); return; }
      }
    };
    void poll();
  });
  const stop = new AbortController();
  const typed = ask("  When done, type  s = I submitted it,  n = not now,  k = skip this job,  q = quit :  ", stop.signal);
  const answer = await Promise.race([typed, confirmed]);
  stop.abort();
  const choice = answer === "detected" ? "s" : answer;
  if (answer === "detected") say("  Confirmation detected: recorded as submitted.");

  let outcome: Outcome = "later";
  if (choice === "s") {
    await submitted("assisted", false, "Prepared by the apply assistant on your computer: it filled the form and you reviewed it and pressed Submit yourself.");
    say("  Recorded as submitted.");
    outcome = "done";
  } else if (choice === "k") {
    await sb.from("jobs").update({ status: "skipped", skip_reason: "Skipped by you in the apply assistant" }).eq("id", job.id);
    await logAct(sb, { kind: "application.skipped", message: "Skipped by you in the apply assistant", status: "skipped", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal });
    outcome = "skipped";
  } else if (choice === "q") outcome = "quit";
  if (!page.isClosed()) await page.close().catch(() => undefined);
  return outcome;
}

/** One pass over everything waiting. Returns how many were recorded as submitted. */
async function batch(sb: SupabaseClient, who: Who | null): Promise<number> {
  await heartbeat(sb);
  const limit = Math.max(1, Math.min(50, Number(process.env.ASSIST_LIMIT ?? 10) || 10));
  const only = process.env.APPLICATION_ID?.trim();
  let q = sb.from("applications").select("id, job_id, resume_doc_id, cover_doc_id, answers").eq("status", "assisted_pending").order("approved_at", { ascending: true }).limit(limit);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw error;
  const apps = (data ?? []) as AppRow[];
  if (!apps.length) { say(WATCH ? `${new Date().toLocaleTimeString()}  Nothing is waiting.` : "Nothing is waiting. Approve applications in the dashboard first (they appear here as \"assisted\")."); return 0; }

  let auto: { caps: AutoCaps; state: AutoState } | null = null;
  if (AUTO) {
    const pausedRow = await sb.from("settings").select("value").eq("key", "automation_pause").maybeSingle();
    if ((pausedRow.data?.value as { paused?: boolean } | null)?.paused) { say("Everything is paused (Settings → Pause everything): hands-free applying waits."); return 0; }
    const caps = await loadCaps(sb);
    if (!(await autoApplyOn(sb))) { say("Auto-Apply is switched off. Turn it on in Settings > Auto-Apply, or run `npm run assist` to press Submit yourself."); return 0; }
    if (!caps.local_auto_enabled) { say("Hands-free mode is switched off. Turn it on in Settings > Application limits, or run `npm run assist` to press Submit yourself."); return 0; }
    auto = { caps, state: await loadAutoState(sb) };
  }
  say(`${apps.length} application(s) are waiting.${auto ? " Hands-free mode is on." : " A browser window will open; sign in to each portal there the first time (your session is kept in a local profile)."}`);

  const profileDir = browserDirFor(who);
  mkdirSync(profileDir, { recursive: true });
  const choice = browserFromMachine(); // the assistant's own Chromium unless you chose Brave, Chrome or Edge (worker/browser.ts)
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.ASSIST_HEADLESS === "1", viewport: null, executablePath: choice.executablePath, channel: choice.channel, ...PLAIN_HTTP,
  });
  await context.addInitScript({ content: "window.__name = window.__name || function (t) { return t; };" });
  let done = 0;
  try {
    for (const [i, app] of apps.entries()) {
      if (i > 0) await sleep(auto ? Number(process.env.ASSIST_AUTO_PAUSE_MS ?? humanPause()) : Number(process.env.ASSIST_PAUSE_MS ?? 4000 + Math.random() * 6000));
      const r = await assistOne(sb, context, app, i + 1, apps.length, auto);
      if (r === "done") done++;
      if (r === "quit") break;
      if (r === "stop") {
        // a security check: hands-free LinkedIn is switched off until you turn it back on
        await sb.from("settings").upsert({ key: "caps", value: { ...(await loadCaps(sb)), linkedin_automation_enabled: false }, updated_at: new Date().toISOString() });
        say("  A portal showed a security check. Automatic LinkedIn applying has been switched off; the rest of this run was cancelled.");
        break;
      }
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return done;
}

async function main(who: Who | null) {
  need("SUPABASE_URL"); need("SUPABASE_SERVICE_ROLE_KEY");
  const sb = scopedDb();
  if (who) say(`Working for: ${who.name}${who.is_default ? " (main profile)" : ""}. Their own sign-ins are kept in ${browserDirFor(who)}.`);
  if (WATCH) {
    if (!AUTO) throw new Error("Watch mode needs hands-free mode: use `npm run assist:watch` (and switch hands-free on in Settings).");
    const pollMs = Math.max(1, Number(process.env.ASSIST_POLL_MINUTES ?? 20)) * 60_000;
    say(`Watching for approved applications every ${pollMs / 60_000} minute(s)${process.env.ASSIST_HOURS ? `, working hours ${process.env.ASSIST_HOURS}` : ""}. Press Ctrl+C to stop.`);
    let nextRound = 0;
    setInterval(() => { void heartbeat(sb); }, 30_000); // keeps beating while a long round is running
    for (;;) {
      await heartbeat(sb);
      // the "Run assistant now" button leaves a request; answer it straight away, whatever the working hours
      const req = (await sb.from("settings").select("value").eq("key", "assistant_request").maybeSingle()).data?.value as AssistantRequest | undefined;
      const requested = requestPending(req);
      if (requested || (Date.now() >= nextRound && withinHours(new Date(), process.env.ASSIST_HOURS))) {
        let n = 0, note = "";
        try { n = await batch(sb, who); if (n) say(`${new Date().toLocaleTimeString()}  ${n} application(s) submitted this round.`); note = `${n} submitted`; }
        catch (e) { note = `failed: ${e instanceof Error ? e.message : e}`; console.error(`round failed (will try again): ${note}`); }
        if (requested) await sb.from("settings").upsert({ key: "assistant_request", value: { at: req!.at, handled_at: new Date().toISOString(), done: n, note }, updated_at: new Date().toISOString() });
        nextRound = Date.now() + pollMs;
      }
      await sleep(30_000);
    }
  }
  const done = await batch(sb, who);
  rl.close();
  say(`\nFinished. ${done} application(s) recorded as submitted.`);
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
