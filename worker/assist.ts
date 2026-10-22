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
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { createInterface } from "node:readline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { scopedDb } from "../src/lib/scoped-db";
import { browserFromMachine, LEAN_BROWSER } from "./browser";
import { skipPortals, takeable } from "./assist-skip";
import { applyStorageState } from "./assist-state";
import { pauseActive } from "../src/lib/pause-rules";
import { chromium, type BrowserContext, type Page } from "playwright";
import { confirmationSnippet, type FieldEntry, type SubmissionRecord } from "../src/lib/apply/submission";
import { MasterProfile } from "../src/lib/types";
import { defaultToolYears, skillYears } from "../src/lib/apply/skill-years";
import { destinationTrust, mentionsCompany, sensitiveReason } from "../src/lib/apply/safety";
import { isRedirector } from "../src/lib/jobs/redirectors";
import { atsLinksIn, findOnEmployerBoards } from "../src/lib/jobs/alt-routes";
import { careersSiteRoutes, googleJobsRoutes, isJobBoardHost, type Found, type RouteId } from "../src/lib/jobs/more-routes";
import { jsearchSearch, jsonFetcher } from "../src/lib/jobs/sources";
import { resolveCredentials } from "../src/lib/integrations/credentials";
import { summariseAttempts, type RouteAttempt } from "../src/lib/apply/route-chain";
import { contactEmailsFor } from "../src/lib/apply/contact-email";
import { loadDraft } from "../src/lib/apply/email-store";
import { accountGatedVendor, applyButtonsSeen, onJobPage, guardDownloads, buttonsShown, linkedinSessionAlive, linkedinSignedOutView, EASY_APPLY_SCOPE, finalStepVisible, leaveJobBoard, linkedinOpenApply, nextStep, openApplyForm, parseLinkedinState, refusedFields, uploadEasyApplyResume, waitForLinkedinApply } from "./assist-lib";
import { requestPending, type AssistantRequest } from "../src/lib/apply/assistant-request";
import { autoDecision, humanPause, withinHours, type AutoCaps, type AutoState } from "./assist-policy";
import { answerPending } from "./ai-answers";
import { newQuestions } from "./ai-answers-core";
import { acquireWatcherLock, lockPathFor } from "./assist-lock";
import { clean, clickSubmit, fillForm, looksLikeSearchForm } from "./form";
import { orderQueue } from "../src/lib/apply/queue-order";
import { NO_FORM, pushRecent, staleLinkedinNoForm, staleOldReading, type Live, type Recent } from "../src/lib/apply/assistant-live";
import { boardDenied, CONFIRMATION, detectBlock, linkedinSignedIn, type Answer } from "./match";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set. Put it in .env.local (see the README, "Apply assistant").`); return v; };
/** A public JSON page (an employer's job board list), or null when it is missing, slow or not JSON. Only fixed, public hosts are ever asked. */
const fetchJson = async (url: string): Promise<unknown | null> => {
  try { const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }); return r.ok ? await r.json() : null; } catch { return null; }
};
/** A public page as HTML text (an employer's careers page), or null when it is missing, slow or not a page. */
const fetchHtml = async (url: string): Promise<string | null> => {
  try { const r = await fetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(8000), redirect: "follow" }); return r.ok ? (await r.text()).slice(0, 600_000) : null; } catch { return null; }
};
/** The JSearch key saved in the app (or the environment), read once; null when there is none. */
let jsearchKeyCache: Promise<string | null> | undefined;
const jsearchKey = () => (jsearchKeyCache ??= resolveCredentials().then((c) => c.creds.jsearch?.rapidapi_key ?? null).catch(() => null));
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

/** What the last round did, so the app can say why applications are still waiting. Reasons are counted, never listed with personal data. */
type Round = { at: string; submitted: number; handedBack: number; left: Record<string, number> };
let current: Round = { at: new Date().toISOString(), submitted: 0, handedBack: 0, left: {} };
let lastRound: Round | null = null;
const leftFor = (reason: string) => { current.left[reason] = (current.left[reason] ?? 0) + 1; };

/** The application being worked on right now, and the latest results. Reported with the heartbeat so the app can show what is happening. */
let live: Live | null = null;
let recent: Recent[] = [];
let lastBeat = 0;
const noteRecent = (r: Omit<Recent, "at">) => { recent = pushRecent(recent, { ...r, at: new Date().toISOString() }); };

/** The browser window the assistant works in: a picture of what it shows is saved every few seconds so the app can show it, wherever the window is on your screen. */
let liveContext: BrowserContext | null = null;
let shooting = false;
async function snap(sb: SupabaseClient): Promise<void> {
  if (!live || !liveContext || shooting) return;
  shooting = true;
  try {
    const pages = liveContext.pages().filter((p) => !p.isClosed());
    const p = pages[pages.length - 1];
    if (!p) return;
    const buf = await p.screenshot({ type: "jpeg", quality: 55, timeout: 4000 });
    const up = await sb.storage.from("documents").upload(`screenshots/${live.id}/live.jpg`, buf, { contentType: "image/jpeg", upsert: true });
    if (!up.error && live) live = { ...live, shotAt: new Date().toISOString() };
  } catch { /* a picture is a courtesy: never a reason to stop */ } finally { shooting = false; }
}

/** Say what the assistant is doing now (at most one extra beat every 4 seconds). Never throws. */
const stepNow = (sb: SupabaseClient, text: string) => {
  if (!live) return;
  live = { ...live, step: text };
  if (Date.now() - lastBeat > 4000) { lastBeat = Date.now(); void heartbeat(sb); }
};

/** Portals the assistant's browser held a sign-in for on its last round (null until the first round has looked). Reported with the heartbeat. */
let signedIn: string[] | null = null;
/** Portals this round gave up on (not signed in, or the site refuses this browser), with the plain reason, so the rest of that portal's queue is not tried one by one. */
/** A file the page tried to download during this application (never accepted: the assistant takes no files and installs nothing). */
let downloadBlocked: string | null = null;
const portalOff = new Map<string, { reason: string; handBack: boolean }>();
const deniedCount = new Map<string, number>();

/** The code this worker runs (a commit), so the app can say whether it is up to date. */
const VERSION = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
})();

/** Tell the app this assistant is alive, so it can warn you if applications are waiting and it has gone quiet. Never throws. */
async function heartbeat(sb: SupabaseClient) {
  if (process.env.ASSIST_NO_HEARTBEAT === "1") {
    // a second worker must not pose as the one on your computer, but says it is alive and which sign-ins it has, so your computer can leave those to it
    const name = process.env.ASSIST_WORKER?.trim();
    if (name && name !== "computer") {
      const portals = (process.env.ASSIST_PORTALS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      try { await sb.from("settings").upsert({ key: `worker_heartbeat:${name}`, value: { at: new Date().toISOString(), portals, version: VERSION }, updated_at: new Date().toISOString() }); } catch { /* a courtesy */ }
    }
    return;
  }
  try {
    await sb.from("settings").upsert({ key: "assistant_heartbeat", value: { at: new Date().toISOString(), version: VERSION, ...(signedIn ? { signedIn } : {}), ...(live ? { live } : {}), ...(recent.length ? { recent } : {}), mode: AUTO ? "hands-free" : "assist", watching: WATCH, hours: process.env.ASSIST_HOURS ?? "", tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(lastRound ? { round: lastRound } : {}) }, updated_at: new Date().toISOString() });
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

/** "adzuna" for any adzuna.* address: the key a refused job board is remembered by. */
const boardKey = (url: string): string => { try { const h = new URL(url).hostname.replace(/^www\./, "").split("."); return `board:${h.length > 2 && h[h.length - 2].length <= 3 ? h[h.length - 3] : h[h.length - 2] ?? ""}`; } catch { return ""; } };

type Outcome = "done" | "later" | "skipped" | "quit" | "stop";
class Handback extends Error {
  constructor(message: string, public stopAll = false, public block: "login" | "captcha" | "checkpoint" | "board" | null = null) { super(message); }
}

/** One application: open it, fill it, then either wait for you (assist) or press Submit within the limits (hands-free). */
async function assistOne(sb: SupabaseClient, context: BrowserContext, app: AppRow, i: number, total: number, auto: { caps: AutoCaps; state: AutoState } | null): Promise<Outcome> {
  const { data: job } = await sb.from("jobs").select("*").eq("id", app.job_id).single();
  if (!job) { say("  (job missing, skipped)"); return "later"; }
  say(`\n[${i}/${total}] ${job.title} at ${job.company}  (${job.portal ?? job.source})\n  ${job.url}`);
  live = { id: app.id, title: job.title, company: job.company, portal: String(job.portal ?? job.source ?? ""), step: "starting", since: new Date().toISOString() };
  // the live picture is served like any stored screenshot, so it must be the application's screenshot while it is being worked on
  await sb.from("applications").update({ screenshot_path: `screenshots/${app.id}/live.jpg` }).eq("id", app.id).then(() => undefined, () => undefined);
  lastBeat = Date.now(); void heartbeat(sb);

  if (auto) {
    const d = autoDecision(job.portal, auto.caps, auto.state);
    if (!d.go) { say(`  Left for later: ${d.reason}.`); leftFor(d.reason); return "later"; }
  }

  // a portal this round already found unusable (not signed in, or it refuses this browser) is not tried one application at a time
  const off = portalOff.get(String(job.portal ?? "").toLowerCase()) ?? portalOff.get(boardKey(job.url));
  if (off) {
    if (!off.handBack) { say(`  Left for later: ${off.reason}.`); leftFor(off.reason); noteRecent({ title: job.title, company: job.company, portal: String(job.portal ?? ""), outcome: "left", note: off.reason }); return "later"; }
    await sb.from("applications").update({ status: "needs_input", error: off.reason }).eq("id", app.id);
    await sb.from("apply_events").insert({ application_id: app.id, kind: "needs_input", detail: { message: off.reason } });
    await logAct(sb, { kind: "application.needs_input", level: "warn", message: `Needs you: ${off.reason}`, status: "needs_input", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { assistant: true, message: off.reason } });
    say(`  Handed back to you: ${off.reason}`);
    noteRecent({ title: job.title, company: job.company, portal: String(job.portal ?? ""), outcome: "handed_back", note: off.reason });
    current.handedBack++;
    return "later";
  }

  const { data: profileRow } = await sb.from("profile").select("data").eq("id", 1).single();
  const profile = MasterProfile.parse(profileRow?.data ?? {});
  const dir = mkdtempSync(join(tmpdir(), "assist-"));
  const files = await downloadDocs(sb, app, dir);
  if (!files.resume) { say("  No prepared resume for this application; skipped."); leftFor("No prepared resume for this application"); return "later"; }
  const fctx = {
    applicant: { name: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone, location: profile.basics.location, links: profile.basics.links, currentCompany: profile.experience[0]?.company },
    answers: app.answers ?? [], resumePath: files.resume.path, coverPath: files.cover?.path,
    skillYears: (skill: string) => skillYears(profile, skill),
    defaultYears: (skill: string) => defaultToolYears(profile, skill),
  };

  const startedAt = new Date().toISOString();
  const entered: FieldEntry[] = [];
  const unanswered: string[] = [];
  let steps = 0;
  let page = await context.newPage();
  downloadBlocked = null;
  const before = new Set(context.pages());
  let formScope: string | undefined; // LinkedIn's Easy Apply window: only the controls inside it belong to the application
  let openNote = "";
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
    noteRecent({ title: job.title, company: job.company, portal: String(job.portal ?? ""), outcome: "submitted", note: "confirmed by the page" });
    await sb.from("apply_events").insert({ application_id: app.id, kind: method === "automated" ? "submitted_hands_free" : "submitted_with_assistant", detail: { fields: entered.length } });
    await logAct(sb, { kind: "application.submitted", message: `${method === "automated" ? "Submitted automatically by the apply assistant" : "Submitted by you with the apply assistant"}: ${job.title} at ${job.company}`, status: "submitted", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { method, assistant: true, fields: entered.length } });
  };
  /** Unattended and stuck: say exactly why and leave it for you. */
  const handBack = async (message: string) => {
    const shot = await screenshot("last-state");
    const patch = { status: "needs_input", error: message, screenshot_path: shot };
    const { error } = await sb.from("applications").update({ ...patch, submission: record("needs_input", "automated", null, message, "The apply assistant stopped and handed this back to you.") }).eq("id", app.id);
    if (error) await sb.from("applications").update(patch).eq("id", app.id);
    await sb.from("apply_events").insert({ application_id: app.id, kind: "needs_input", detail: { message, assistant: true } });
    await logAct(sb, { kind: "application.needs_input", level: "warn", message: `Needs you: ${message}`, status: "needs_input", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { assistant: true, message } });
    say(`  Handed back to you: ${message}`);
    noteRecent({ title: job.title, company: job.company, portal: String(job.portal ?? ""), outcome: "handed_back", note: message });
    current.handedBack++;
  };

  try {
    stepNow(sb, "opening the job page");
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // a job board that answers "Access Denied" has refused this browser: after two such answers its other jobs are handed back at once
    if (isRedirector(job.url) && boardDenied(await page.title().catch(() => ""), await page.innerText("body").catch(() => ""))) {
      const key = boardKey(job.url), n = (deniedCount.get(key) ?? 0) + 1;
      deniedCount.set(key, n);
      if (n >= 2) {
        let host = ""; try { host = new URL(job.url).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
        portalOff.set(key, { reason: `${host || "The job board"} answers "Access Denied" to the assistant's browser, so this job can only be applied for on the employer's own site (open the link and apply there)`, handBack: true });
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const b = await blocked(page);
      if (!b) break;
      if (auto) throw new Handback(b === "login" ? "The portal asked for a sign-in: open the assistant once without hands-free mode and sign in" : b === "captcha" ? "The page shows a CAPTCHA; please do this one yourself" : "The portal shows a security check; automatic applying was stopped for safety", b === "checkpoint", b);
      await waitForHuman(page, b === "login" ? "This portal wants you to sign in." : b === "captcha" ? "There is a CAPTCHA." : "The portal shows a security check.");
    }
    // a job board's listing page has no form: follow its Apply link to the employer's own site first
    let board = await leaveJobBoard(page, isRedirector);
    page = board.page;
    // every way in that is tried is recorded, in order, so a hand-back says exactly what was attempted
    const attempts: RouteAttempt[] = [{ route: "board-link", outcome: board.left ? "worked" : "no-link" }];
    const facts = { title: job.title, company: job.company, location: job.location, description: job.description };
    const tryRoute = async (route: RouteId, find: () => Promise<Found[]>): Promise<boolean> => {
      let list: Found[];
      try { list = await find(); } catch (e) { attempts.push({ route, outcome: "error", detail: e instanceof Error ? e.message.split("\n")[0].slice(0, 80) : "unknown" }); return false; }
      if (list.length === 0) { attempts.push({ route, outcome: "none-found" }); return false; }
      for (const alt of list) {
        await page.goto(alt.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
        if (isRedirector(page.url()) || (await looksLikeSearchForm(page))) continue;
        if (await blocked(page)) continue;
        say(`  Found another way in: ${alt.how}`);
        await sb.from("jobs").update({ url: alt.url, ...(alt.ats === "greenhouse" || alt.ats === "lever" ? { apply_type: alt.ats } : {}) }).eq("id", job.id);
        await logAct(sb, { kind: "job.link_resolved", message: `Found the employer's own application page for ${job.title} at ${job.company}: ${alt.how}`, application_id: app.id, job_id: job.id, company: job.company, portal: job.portal, detail: { url: alt.url, how: alt.how, route, assistant: true } });
        attempts.push({ route, outcome: "worked", detail: alt.how });
        return true;
      }
      attempts.push({ route, outcome: "unusable", detail: `${list.length} link(s)` });
      return false;
    };
    if (!board.left) {
      stepNow(sb, "looking for another way to the employer's form");
      const listing = await page.content().catch(() => null);
      const chain: [RouteId, () => Promise<Found[]>][] = [
        ["description-link", async () => atsLinksIn(job.description)],
        ["employer-board", async () => { const f = await findOnEmployerBoards(facts, { getJson: fetchJson }); return f ? [f] : []; }],
        ["careers-site", () => careersSiteRoutes(facts, { getJson: fetchJson, getHtml: fetchHtml }, listing)],
        ["google-jobs", async () => {
          const key = await jsearchKey();
          if (!key) throw new Error("no JSearch key");
          return googleJobsRoutes(facts, (q) => jsearchSearch(jsonFetcher(), key, q));
        }],
      ];
      for (const [route, find] of chain) {
        if (await tryRoute(route, find)) { board = { page, left: true }; break; }
      }
    }
    // the email route needs no form: an address in the posting is another way to apply, sent alongside by the app itself
    const emailed = await loadDraft(app.id).then((d) => d?.sent ? d.sent.to : null).catch(() => null);
    const listed = contactEmailsFor({ url: job.url, description: job.description, company: job.company });
    attempts.push(emailed ? { route: "email", outcome: "worked", detail: `already emailed to ${emailed}` } : { route: "email", outcome: listed.length ? "unavailable" : "none-found", detail: listed.length ? "an address is listed, but no email application was sent for this job" : undefined });
    if (!board.left && auto) {
      const title = (await board.page.title().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 70);
      let host = ""; try { host = new URL(board.page.url()).hostname; } catch { /* keep blank */ }
      await sb.from("apply_events").insert({ application_id: app.id, kind: "routes_tried", detail: { attempts } }).then(() => undefined, () => undefined);
      throw new Handback(`No route reached the employer's form. ${summariseAttempts(attempts)} The page on ${host || "the board"} is titled "${title || "no title"}"; apply on the employer's own site`, false, "board");
    }
    const onLinkedin = String(job.portal ?? "").toLowerCase() === "linkedin";
    if (onLinkedin) {
      // LinkedIn builds its job page after the first load, and says in its own words when you already applied or the role is closed
      stepNow(sb, "waiting for LinkedIn to show the apply button");
      await waitForLinkedinApply(page);
      const st = parseLinkedinState(await page.innerText("body").catch(() => ""));
      if (st.applied) {
        const now = new Date().toISOString();
        await sb.from("applications").update({ status: "submitted", method: "assisted", lifecycle: "applied", submitted_at: now, error: null }).eq("id", app.id);
        await sb.from("jobs").update({ status: "applied" }).eq("id", job.id);
        await sb.from("apply_events").insert({ application_id: app.id, kind: "marked_submitted", detail: { why: `LinkedIn's own page says "${st.applied}"` } });
        await logAct(sb, { kind: "application.submitted", message: `Already applied (LinkedIn shows "${st.applied}"): ${job.title} at ${job.company}`, status: "submitted", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { method: "assisted", assistant: true, linkedin_says: st.applied } });
        noteRecent({ title: job.title, company: job.company, portal: "linkedin", outcome: "submitted", note: `LinkedIn already shows "${st.applied}"` });
        say(`  Already applied: LinkedIn shows "${st.applied}".`);
        await page.close().catch(() => undefined);
        return "later";
      }
      if (st.closed) throw new Handback("LinkedIn says this role is no longer accepting applications");
      if (!onJobPage(page.url(), job.url)) throw new Handback(`LinkedIn moved the assistant from this job to its search results before anything was pressed, so nothing was pressed; the job may still be open: open it and apply`);
    }
    let opened: "already" | "clicked" | "none";
    if (onLinkedin) {
      // LinkedIn sends a removed or closed job to its search results, where an Easy Apply button belongs to some other job: never press it
      if (!onJobPage(page.url(), job.url)) {
        let where = ""; try { where = new URL(page.url()).pathname; } catch { /* keep blank */ }
        throw new Handback(`LinkedIn moved the assistant from this job to ${where || "another page"} before anything was pressed, so nothing was pressed; the job may still be open: open it and apply`);
      }
      stepNow(sb, "opening the application on LinkedIn");
      const r = await linkedinOpenApply(context, page, job.url);
      openNote = r.note;
      say(`  LinkedIn: ${r.note}.`);
      if (r.kind === "easy") {
        formScope = r.scope ?? EASY_APPLY_SCOPE; opened = "clicked";
        // the window must be for this employer: a window for another company means the click landed on another job
        const heading = await page.locator(`${formScope} >> visible=true`).first().innerText({ timeout: 4000 }).catch(() => "");
        if (heading && !mentionsCompany(heading.slice(0, 400), job.company)) throw new Handback(`The Easy Apply window that opened was not for ${job.company} ("${heading.replace(/\s+/g, " ").trim().slice(0, 60)}"), so it was closed without filling anything`);
      }
      else if (r.kind === "external") { page = r.page; opened = "clicked"; await logAct(sb, { kind: "job.link_resolved", message: `LinkedIn sent the assistant to the company's own page for ${job.title} at ${job.company}`, application_id: app.id, job_id: job.id, company: job.company, portal: job.portal, detail: { how: r.note, assistant: true } }); }
      else opened = "none";
    } else opened = await openApplyForm(page);
    const fresh = context.pages().filter((p) => !before.has(p) && p !== page);
    if (fresh.length) page = fresh[fresh.length - 1]; // the apply button opened a new tab
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await sleep(1200);
    if (onLinkedin && !formScope && opened === "clicked") {
      // LinkedIn sent us to the company's own page: an overview with its own Apply button (Ashby and many careers sites), pressed up to twice
      for (let hop = 0; hop < 2; hop++) {
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
        if (/linkedin\.com/i.test(page.url())) break;
        const o = await openApplyForm(page);
        if (o !== "clicked") break;
        const more = context.pages().filter((p) => !before.has(p) && p !== page && !p.isClosed());
        if (more.length) page = more[more.length - 1];
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        await sleep(1500);
      }
    }
    if (opened === "none" && !auto) say("  No apply button found on this page. The form may be on the employer's site: use the open window.");

    let resumeSent = false;
    const askedModel = new Set<string>();
    for (let step = 0; step < 8; step++) {
      stepNow(sb, `filling the form (page ${step + 1})`);
      if (downloadBlocked) throw new Handback(`The page tried to download a file ("${downloadBlocked}"). The assistant never downloads or installs anything: it stopped without touching the file. Check the page before going further`);
      if (!formScope && (await looksLikeSearchForm(page))) break; // a job board's search box is not an application: nothing is typed into it
      if (!formScope) {
        // the page must be the employer's: a known application system, or a page that names the company, and never one that reads like a scam
        let host = ""; try { host = new URL(page.url()).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
        if (host && !isJobBoardHost(host)) {
          await page.waitForLoadState("load", { timeout: 8000 }).catch(() => undefined);
          const trust = destinationTrust({ host, title: await page.title().catch(() => ""), body: await page.innerText("body").catch(() => ""), company: job.company });
          if (!trust.ok) throw new Handback(`Did not touch this page: ${trust.why}. If it is the real application page, open it and apply there yourself`);
        }
      }
      if (formScope && !resumeSent) {
        const sent = await uploadEasyApplyResume(page, formScope, files.resume.path).catch(() => null);
        if (sent) { resumeSent = true; entered.push({ label: "Resume", value: sent, kind: "file", source: "upload" }); say(`  Uploaded the resume written for this job (${sent}).`); }
      }
      let r = await fillForm(page, fctx, formScope);
      if (r.blocked.length) { // a password, a payment or identity number, a code: the assistant stops here, it does not offer these as questions
        let host = ""; try { host = new URL(page.url()).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
        throw new Handback(sensitiveReason(r.blocked[0].kind, host));
      }
      const toAsk = newQuestions(r.pending, askedModel);
      if (toAsk.length) {
        // questions the rules and the answer bank could not answer are answered from the profile by a model, never by guessing
        const extra = await answerPending({ profile, bank: fctx.answers, job: { title: job.title, company: job.company, description: job.description }, pending: toAsk, jobId: job.id });
        if (extra.length) {
          fctx.answers = [...fctx.answers, ...extra];
          const ai = new Set(extra.map((e) => e.question));
          const again = await fillForm(page, fctx, formScope);
          r = { filled: [...r.filled, ...again.filled], unanswered: again.unanswered, pending: again.pending, blocked: again.blocked, entries: [...r.entries, ...again.entries.filter((e) => e.kind !== "file").map((e) => (ai.has(e.label) ? { ...e, source: "ai" as const } : e))] };
          say(`  Answered ${extra.length} question(s) from your profile.`);
        }
      }
      entered.push(...r.entries); steps++;
      for (const u of r.unanswered) if (!unanswered.includes(u)) unanswered.push(u);
      if (await finalStepVisible(page, formScope)) break;
      if (!(await nextStep(page, formScope))) break;
      await sleep(900);
      if (formScope) {
        // LinkedIn keeps the same page and marks the question it refused: that question is the one to hand back, answered from the app next time
        const refused = (await refusedFields(page, formScope)).map(clean).filter(Boolean);
        if (refused.length) { for (const q of refused) if (!unanswered.includes(q)) unanswered.push(q); say(`  The form did not accept: ${refused.join("; ")}.`); break; }
      }
    }
  } catch (e) {
    if (e instanceof Handback) {
      // a worker on a cloud address that meets a sign-in page or a security check passes the application on to another worker
      // (your computer) instead of handing it to you, and leaves that portal alone for a few hours
      if (FAILOVER && e.block) {
        await sb.from("apply_events").insert({ application_id: app.id, kind: "worker_declined", detail: { worker: WORKER, reason: e.block, portal: job.portal ?? null } });
        if (job.portal && e.block !== "board") blockedPortals.set(String(job.portal).toLowerCase(), Date.now() + 6 * 3_600_000);
        leftFor(e.block === "board" ? `${job.portal ?? "the job board"} did not lead to the employer's form from this worker: passed to another worker` : `${job.portal ?? "this site"} showed a ${e.block === "login" ? "sign-in page" : e.block === "captcha" ? "CAPTCHA" : "security check"} to this worker: passed to another worker`);
        say(`  Passed on to another worker: ${e.message}`);
        await page.close().catch(() => undefined);
        return "later";
      }
      await handBack(e.message); await page.close().catch(() => undefined); return e.stopAll ? "stop" : "later";
    }
    if (auto) { await handBack(`Could not prepare the page automatically (${e instanceof Error ? e.message.split("\n")[0] : e})`); await page.close().catch(() => undefined); return "later"; }
    say(`  Could not finish preparing this page automatically (${e instanceof Error ? e.message.split("\n")[0] : e}). The window is open: you can still complete it by hand.`);
  }

  say(`  Filled ${entered.length} field(s) from your package.`);
  if (unanswered.length) say(`  Needs you: ${unanswered.join("; ")}`);

  // ---- hands-free: press Submit only when everything required was answered, then check the portal confirmed it
  if (auto) {
    let problem: string | null = null;
    if (unanswered.length) problem = `Needs you: ${unanswered.join("; ")}`;
    else if (!formScope && (await looksLikeSearchForm(page))) problem = "The link opens a job board's listing or search page, not an application form; apply on the employer's own site";
    else if (entered.length === 0) {
      if (String(job.portal ?? "").toLowerCase() === "linkedin" && (await linkedinSignedOutView(page)) && (await linkedinSessionAlive(context)) !== true) {
        const reason = "LinkedIn shows its signed-out page in the assistant's browser (its saved sign-in is missing or has expired): run  npm run assist:login , sign in to LinkedIn, close the window";
        portalOff.set("linkedin", { reason, handBack: false });
        say(`  Left for later: ${reason}.`); leftFor(reason);
        await page.close().catch(() => undefined);
        return "later";
      }
      if (String(job.portal ?? "").toLowerCase() === "linkedin") {
        if (!/linkedin\.com/i.test(page.url())) {
          let host = ""; try { host = new URL(page.url()).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
          const vendor = accountGatedVendor(host);
          problem = vendor
            ? `LinkedIn sent the assistant to the company's ${vendor} page (${host}). ${vendor} makes you create or sign in to an account for each employer, and the assistant does not create accounts: open the link and apply there`
            : `LinkedIn sent the assistant to the company's page (${host || "its site"}), but no application form was found there (it may need an account or have another step); apply on that page`;
        } else {
          const seen = await applyButtonsSeen(page);
          problem = `LinkedIn: ${openNote || "no application form found"}. Buttons the page showed: ${seen.length ? seen.join(" | ") : "none that mention apply"}`;
        }
      } else problem = "No application form was found on this page (it may need a sign-in, or the role may be closed); apply on the employer's site";
    }
    else if (!(await finalStepVisible(page, formScope))) {
      let host = ""; try { host = new URL(page.url()).hostname.replace(/^www\./, ""); } catch { /* keep blank */ }
      const seen = await buttonsShown(page, formScope);
      problem = `Could not reach the final step of the form (stopped on ${host || "the page"} after ${steps} page${steps === 1 ? "" : "s"}, ${entered.length} field${entered.length === 1 ? "" : "s"} filled; buttons on the page: ${seen.length ? seen.join(" | ") : "none"})`;
    }
    if (problem) { await handBack(problem); await page.close().catch(() => undefined); return "later"; }
    stepNow(sb, "pressing Submit");
    const baseline = CONFIRMATION.test(await page.innerText("body").catch(() => ""));
    let pressed = false;
    try { pressed = await clickSubmit(page); }
    catch (e) { await handBack(`Could not press the submit button (${e instanceof Error ? e.message.split("\n")[0] : e})`); await page.close().catch(() => undefined); return "later"; }
    if (!pressed) { await handBack("Could not find the submit button"); await page.close().catch(() => undefined); return "later"; }
    stepNow(sb, "waiting for the employer's confirmation");
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

const WORKER = process.env.ASSIST_WORKER?.trim() || "computer";
/** A worker on a cloud address: a sign-in page or security check is passed on to another worker, not handed to you. */
const FAILOVER = process.env.ASSIST_FAILOVER === "1";
/** Portals this worker has met a block on, with when it will try them again. */
const blockedPortals = new Map<string, number>();

/** Atomically move an application from "waiting for the assistant" to "being sent" by this worker. False when another worker got there first. */
async function claim(sb: SupabaseClient, id: string): Promise<boolean> {
  const r = await sb.from("applications").update({ status: "submitting", error: null }).eq("id", id).eq("status", "assisted_pending").select("id");
  if (r.error || !r.data?.length) return false;
  await sb.from("apply_events").insert({ application_id: id, kind: "worker_started", detail: { worker: WORKER } });
  return true;
}

/** Put an application this worker did not finish back in the queue. An application that was submitted or handed back already has another status and is left alone. */
async function release(sb: SupabaseClient, id: string) {
  await sb.from("applications").update({ status: "assisted_pending" }).eq("id", id).eq("status", "submitting");
}

/** One pass over everything waiting. Returns how many were recorded as submitted. */
async function batch(sb: SupabaseClient, who: Who | null): Promise<number> {
  await heartbeat(sb);
  // hands-free rounds take a larger bite: the daily limit, not the round size, is what paces the day
  const limit = Math.max(1, Math.min(50, Number(process.env.ASSIST_LIMIT ?? (AUTO ? 40 : 10)) || (AUTO ? 40 : 10)));
  // the cloud assistant (a GitHub runner, ASSIST_ONLY=employer) takes employers' own pages when you switched it on (Autopilot does);
  // the assistant on your computer then leaves exactly those pages alone, so the two never work on the same application
  const cloud = (await sb.from("settings").select("value").eq("key", "cloud_assist").maybeSingle()).data?.value as { enabled?: boolean; fallback_minutes?: number } | undefined;
  const cloudOn = !!cloud?.enabled;
  const only = skipPortals(process.env.ASSIST_ONLY);
  if (only.length && !cloudOn) { say("The cloud assistant is switched off (Autopilot turns it on). Nothing to do here."); return 0; }
  const skip = skipPortals(process.env.ASSIST_SKIP);
  // when other workers are switched on, the assistant on your computer lets them have the first go and takes over what they cannot do:
  //  - employers' own pages: after they have waited too long (the other workers down, busy or out of time);
  //  - LinkedIn, Indeed, Naukri: only while a worker that holds those sign-ins is reporting in; once it stops, or passes one on, they are yours
  const defer: string[] = [];
  if (cloudOn && only.length === 0 && WORKER === "computer") {
    defer.push("employer");
    for (const name of (process.env.ASSIST_PEERS ?? "oracle").split(",").map((x) => x.trim()).filter(Boolean)) {
      const hb = (await sb.from("settings").select("value").eq("key", `worker_heartbeat:${name}`).maybeSingle()).data?.value as { at?: string; portals?: string[] } | undefined;
      if (hb?.at && Date.now() - new Date(hb.at).getTime() < 10 * 60_000) defer.push(...(hb.portals ?? []));
    }
  }
  const deferMs = Math.max(1, Number(process.env.ASSIST_FALLBACK_MINUTES ?? cloud?.fallback_minutes ?? 90) || 90) * 60_000;
  const one = process.env.APPLICATION_ID?.trim();
  let q = sb.from("applications").select("id, job_id, resume_doc_id, cover_doc_id, answers, approved_at").eq("status", "assisted_pending").order("approved_at", { ascending: true }).limit(200);
  if (one) q = q.eq("id", one);
  const { data, error } = await q;
  if (error) throw error;
  let apps = (data ?? []) as (AppRow & { approved_at?: string | null })[];
  if (apps.length) {
    const { data: jobs } = await sb.from("jobs").select("id, portal, source, apply_type, url").in("id", apps.map((a) => a.job_id));
    type J = { id: string; portal?: string | null; source?: string | null; apply_type?: string | null; url?: string | null; score?: number | null };
    const scoreRows = ((await sb.from("job_scores").select("job_id, score").in("job_id", apps.map((a) => a.job_id))).data ?? []) as { job_id: string; score: number | null }[];
    const scoreOfJob = new Map(scoreRows.map((r) => [r.job_id, r.score]));
    const byId = new Map(((jobs ?? []) as J[]).map((j) => [j.id, { ...j, score: scoreOfJob.get(j.id) ?? null }]));
    // which workers already tried an application and passed it on (a sign-in page, a security check)
    const declined = new Map<string, string[]>();
    const ev = await sb.from("apply_events").select("application_id, detail").eq("kind", "worker_declined").in("application_id", apps.map((a) => a.id));
    for (const e of (ev.data ?? []) as { application_id: string; detail: { worker?: string } | null }[]) declined.set(e.application_id, [...(declined.get(e.application_id) ?? []), e.detail?.worker ?? "?"]);
    const now = Date.now();
    apps = orderQueue(apps.filter((a) => {
      const j = byId.get(a.job_id);
      if (!j) return false;
      const until = blockedPortals.get(String(j.portal ?? "").toLowerCase());
      if (until && until > now) return false; // this worker met a block on that portal a short while ago
      return takeable(j, a.approved_at ?? null, { skip, only, defer, deferMs, now, me: WORKER, declined: declined.get(a.id) });
    }), (a) => byId.get(a.job_id)).slice(0, limit); // applicable jobs first: the round is limited, and a job board that refuses the browser must not use it up
  }
  if (!apps.length) { say(WATCH ? `${new Date().toLocaleTimeString()}  Nothing is waiting.` : "Nothing is waiting. Approve applications in the dashboard first (they appear here as \"assisted\")."); return 0; }

  let auto: { caps: AutoCaps; state: AutoState } | null = null;
  if (AUTO) {
    const pausedRow = await sb.from("settings").select("value").eq("key", "automation_pause").maybeSingle();
    if (pauseActive(pausedRow.data?.value as { paused?: boolean; until?: string } | null)) { say("Everything is paused (Settings → Pause everything): hands-free applying waits."); return 0; }
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
    headless: process.env.ASSIST_HEADLESS === "1", viewport: null, acceptDownloads: false, executablePath: choice.executablePath, channel: choice.channel, ...LEAN_BROWSER,
  });
  await context.addInitScript({ content: "window.__name = window.__name || function (t) { return t; };" });
  liveContext = context;
  // nothing is ever downloaded: a page that offers a file or a program is noted, the download cancelled, and the application handed back
  guardDownloads(context, (name) => { downloadBlocked = name; });
  if (await applyStorageState(context, process.env.ASSIST_STORAGE_STATE, profileDir)) say("Sign-ins loaded from the exported file.");
  // is the assistant's browser signed in to LinkedIn? Without it every LinkedIn job is the public, signed-out page with no Easy Apply button
  portalOff.clear(); deniedCount.clear();
  try {
    signedIn = linkedinSignedIn(await context.cookies("https://www.linkedin.com")) ? ["linkedin"] : [];
    if (!signedIn.includes("linkedin")) {
      const reason = "The assistant's browser is not signed in to LinkedIn: run  npm run assist:login , sign in to LinkedIn, close the window";
      portalOff.set("linkedin", { reason, handBack: false });
      say(`  ${reason}. LinkedIn applications wait until then.`);
    }
  } catch { signedIn = null; }
  // LinkedIn applications handed back as "no application form" while the browser was signed out are put back in the queue once (they are taken next round)
  if (signedIn?.includes("linkedin")) {
    try {
      const rows = ((await sb.from("applications").select("id, job_id, error").eq("status", "needs_input").like("error", `${NO_FORM}%`).limit(300)).data ?? []) as { id: string; job_id: string; error: string | null }[];
      if (rows.length) {
        const jobs = ((await sb.from("jobs").select("id, portal").in("id", [...new Set(rows.map((r) => r.job_id))])).data ?? []) as { id: string; portal: string | null }[];
        const retried = new Set((((await sb.from("apply_events").select("application_id").eq("kind", "auto_retry").in("application_id", rows.map((r) => r.id))).data ?? []) as { application_id: string }[]).map((e) => e.application_id));
        const ids = staleLinkedinNoForm(rows, new Map(jobs.map((j) => [j.id, j.portal])), retried);
        if (ids.length) {
          const upd = await sb.from("applications").update({ status: "assisted_pending", error: null }).in("id", ids).eq("status", "needs_input").select("id");
          const back = ((upd.data ?? []) as { id: string }[]).map((r) => r.id);
          if (back.length) {
            await sb.from("apply_events").insert(back.map((id) => ({ application_id: id, kind: "auto_retry", detail: { reason: "LinkedIn is signed in now; the earlier 'no application form' was the signed-out page" } })));
            say(`  Put ${back.length} LinkedIn application(s) back in the queue: they were handed back while the browser was signed out.`);
          }
        }
      }
    } catch { /* a courtesy: the rest of the round goes on */ }
  }
  // hand-backs an older assistant could not read (a lone Yes or No box, a password offered as a question, no detail) get one more try with this version
  try {
    const rows = ((await sb.from("applications").select("id, error").eq("status", "needs_input").limit(300)).data ?? []) as { id: string; error: string | null }[];
    const candidates = rows.filter((r) => staleOldReading([r], new Set()).length);
    if (candidates.length) {
      const retried = new Set((((await sb.from("apply_events").select("application_id").eq("kind", "auto_retry").in("application_id", candidates.map((r) => r.id))).data ?? []) as { application_id: string }[]).map((e) => e.application_id));
      const ids = staleOldReading(candidates, retried);
      if (ids.length) {
        const upd = await sb.from("applications").update({ status: "assisted_pending", error: null }).in("id", ids).eq("status", "needs_input").select("id");
        const back = ((upd.data ?? []) as { id: string }[]).map((r) => r.id);
        if (back.length) {
          await sb.from("apply_events").insert(back.map((id) => ({ application_id: id, kind: "auto_retry", detail: { reason: "an older assistant could not read this form; tried again with this version" } })));
          say(`  Put ${back.length} application(s) back in the queue: an older version of the assistant could not read their forms.`);
        }
      }
    }
  } catch { /* a courtesy */ }
  let done = 0, attempted = false;
  // a cloud run must end inside its runner time limit: no new application is started after this many minutes (the rest waits for the next run)
  const stopAt = Number(process.env.ASSIST_MAX_MINUTES) > 0 ? Date.now() + Number(process.env.ASSIST_MAX_MINUTES) * 60_000 : Infinity;
  current = { at: new Date().toISOString(), submitted: 0, handedBack: 0, left: {} };
  try {
    for (const [i, app] of apps.entries()) {
      if (Date.now() > stopAt) { say("  The time budget of this run is used up; the rest waits for the next run."); break; }
      // the pause protects the portal from a burst of applications, so it follows an application that was really attempted, not one skipped because another worker had it
      if (i > 0 && attempted) await sleep(auto ? Number(process.env.ASSIST_AUTO_PAUSE_MS ?? humanPause()) : Number(process.env.ASSIST_PAUSE_MS ?? 4000 + Math.random() * 6000));
      // a pause starts at once, not at the next round
      if (AUTO && i > 0 && pauseActive((await sb.from("settings").select("value").eq("key", "automation_pause").maybeSingle()).data?.value as { paused?: boolean; until?: string } | null)) { say("Paused (Settings → Pause everything): stopping after the application in progress."); break; }
      // take the application before touching it: only one worker can, so two assistants never submit the same one
      attempted = false;
      if (!(await claim(sb, app.id))) { say(`  [${i + 1}/${apps.length}] taken by another assistant; skipped.`); continue; }
      attempted = true;
      let r: Outcome;
      try { r = await assistOne(sb, context, app, i + 1, apps.length, auto); }
      catch (e) {
        // one application that goes wrong must not end the round: it is handed back with the reason, and the next one is taken
        r = "later";
        const message = `The assistant could not finish this one (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`;
        say(`  Handed back to you: ${message}`);
        await sb.from("applications").update({ status: "needs_input", error: message }).eq("id", app.id).eq("status", "submitting");
        await sb.from("apply_events").insert({ application_id: app.id, kind: "needs_input", detail: { message, worker: WORKER, assistant: true } });
        current.handedBack++;
      }
      finally { live = null; await release(sb, app.id); } // anything not finished or handed back goes back to the queue for the next round, or for another worker
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
    liveContext = null;
    await context.close().catch(() => undefined);
    current.submitted = done;
    lastRound = current;
    await heartbeat(sb);
  }
  return done;
}

async function main(who: Who | null) {
  need("SUPABASE_URL"); need("SUPABASE_SERVICE_ROLE_KEY");
  const sb = scopedDb();
  if (who) say(`Working for: ${who.name}${who.is_default ? " (main profile)" : ""}. Their own sign-ins are kept in ${browserDirFor(who)}.`);
  if (WATCH) {
    if (!AUTO) throw new Error("Watch mode needs hands-free mode: use `npm run assist:watch` (and switch hands-free on in Settings).");
    // one watcher per profile: two would double the memory and processor use of the browsers
    const release = await acquireWatcherLock(lockPathFor(who ? who.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : ""), say, async (ms) => { await sleep(ms); });
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { release(); process.exit(0); });
    process.on("exit", release);
    const pollMs = Math.max(1, Number(process.env.ASSIST_POLL_MINUTES ?? 20)) * 60_000;
    say(`Watching for approved applications every ${pollMs / 60_000} minute(s)${process.env.ASSIST_HOURS ? `, working hours ${process.env.ASSIST_HOURS}` : ""}. Press Ctrl+C to stop.`);
    let nextRound = 0;
    setInterval(() => { void heartbeat(sb); }, 30_000); // keeps beating while a long round is running
    setInterval(() => { void snap(sb).then(() => { if (live?.shotAt) void heartbeat(sb); }); }, 8000); // what the assistant sees, for the app
    for (;;) {
      await heartbeat(sb);
      // the "Run assistant now" button leaves a request; answer it straight away, whatever the working hours
      const req = process.env.ASSIST_NO_HEARTBEAT === "1" ? undefined : ((await sb.from("settings").select("value").eq("key", "assistant_request").maybeSingle()).data?.value as AssistantRequest | undefined); // only the main assistant answers the Run-now button
      const requested = requestPending(req);
      if (requested || (Date.now() >= nextRound && withinHours(new Date(), process.env.ASSIST_HOURS))) {
        let n = 0, note = "";
        try { n = await batch(sb, who); if (n) say(`${new Date().toLocaleTimeString()}  ${n} application(s) submitted this round.`); note = `${n} submitted`; }
        catch (e) { note = `failed: ${e instanceof Error ? e.message : e}`; console.error(`round failed (will try again): ${note}`); }
        if (requested) await sb.from("settings").upsert({ key: "assistant_request", value: { at: req!.at, handled_at: new Date().toISOString(), done: n, note }, updated_at: new Date().toISOString() });
        // a round that sent something is followed by another after a minute, so a backlog clears without waiting for the next check
        nextRound = Date.now() + (n > 0 ? 60_000 : pollMs);
      }
      await sleep(30_000);
    }
  }
  const done = await batch(sb, who);
  rl.close();
  say(`\nFinished. ${done} application(s) recorded as submitted.`);
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
