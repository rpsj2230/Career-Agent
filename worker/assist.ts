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
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";
import { confirmationSnippet, type FieldEntry, type SubmissionRecord } from "../src/lib/apply/submission";
import { MasterProfile } from "../src/lib/types";
import { finalStepVisible, nextStep, openApplyForm } from "./assist-lib";
import { fillForm } from "./form";
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
  return { resume: await get("resume", "Resume.docx"), cover: await get("cover_letter", "Cover-Letter.docx") };
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

async function assistOne(sb: SupabaseClient, context: BrowserContext, app: AppRow, i: number, total: number): Promise<"done" | "later" | "skipped" | "quit"> {
  const { data: job } = await sb.from("jobs").select("*").eq("id", app.job_id).single();
  if (!job) { say("  (job missing, skipped)"); return "later"; }
  say(`\n[${i}/${total}] ${job.title} at ${job.company}  (${job.portal ?? job.source})\n  ${job.url}`);

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
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    for (let attempt = 0; attempt < 3; attempt++) {
      const b = await blocked(page);
      if (!b) break;
      await waitForHuman(page, b === "login" ? "This portal wants you to sign in." : b === "captcha" ? "There is a CAPTCHA." : "The portal shows a security check.");
    }
    const opened = await openApplyForm(page);
    const fresh = context.pages().filter((p) => !before.has(p) && p !== page);
    if (fresh.length) page = fresh[fresh.length - 1]; // the apply button opened a new tab
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await sleep(1200);
    if (opened === "none") say("  No apply button found on this page. The form may be on the employer's site: use the open window.");

    for (let step = 0; step < 8; step++) {
      const r = await fillForm(page, fctx);
      entered.push(...r.entries); steps++;
      for (const u of r.unanswered) if (!unanswered.includes(u)) unanswered.push(u);
      if (await finalStepVisible(page)) break;
      if (!(await nextStep(page))) break;
      await sleep(900);
    }
  } catch (e) {
    say(`  Could not finish preparing this page automatically (${e instanceof Error ? e.message.split("\n")[0] : e}). The window is open: you can still complete it by hand.`);
  }

  say(`  Filled ${entered.length} field(s) from your package.`);
  if (unanswered.length) say(`  Needs you: ${unanswered.join("; ")}`);
  say("  Review the form in the browser window, then press the portal's own Submit button yourself.");

  // Wait for you. The page's confirmation message also counts, so you need only press Submit.
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

  let outcome: "done" | "later" | "skipped" | "quit" = "later";
  if (choice === "s") {
    const text = await page.innerText("body").catch(() => "");
    let shot: string | null = null;
    try {
      shot = `screenshots/${app.id}/confirmation.png`;
      await sb.storage.from("documents").upload(shot, await page.screenshot({ fullPage: true }), { contentType: "image/png", upsert: true });
    } catch { shot = null; }
    const now = new Date();
    const fileInfo = (role: "resume" | "cover_letter", f: { path: string; storage_path: string }) => ({ role, name: basename(f.path), bytes: statSync(f.path).size, sha256: sha256(f.path), storage_path: f.storage_path });
    const record: SubmissionRecord = {
      version: 1, method: "assisted", outcome: "submitted", started_at: startedAt, finished_at: now.toISOString(), target_url: job.url, final_url: page.isClosed() ? null : page.url(),
      fields: entered, files: [fileInfo("resume", files.resume), ...(files.cover ? [fileInfo("cover_letter", files.cover)] : [])], unanswered,
      confirmation: CONFIRMATION.test(text) ? { text: confirmationSnippet(text, CONFIRMATION), screenshot: shot } : null, error: null, steps,
      note: "Prepared by the apply assistant on your computer: it filled the form and you reviewed it and pressed Submit yourself.",
    };
    const patch = { status: "submitted", method: "assisted", submitted_at: now.toISOString(), lifecycle: "applied", screenshot_path: shot };
    const { error } = await sb.from("applications").update({ ...patch, submission: record }).eq("id", app.id);
    if (error) await sb.from("applications").update(patch).eq("id", app.id);
    await sb.from("jobs").update({ status: "applied" }).eq("id", job.id);
    await sb.from("apply_events").insert({ application_id: app.id, kind: "submitted_with_assistant", detail: { fields: entered.length } });
    await logAct(sb, { kind: "application.submitted", message: `Submitted by you with the apply assistant: ${job.title} at ${job.company}`, status: "submitted", application_id: app.id, job_id: job.id, company: job.company, country: job.country, portal: job.portal, detail: { method: "assisted", assistant: true, fields: entered.length } });
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

async function main() {
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const limit = Math.max(1, Math.min(50, Number(process.env.ASSIST_LIMIT ?? 10) || 10));
  const only = process.env.APPLICATION_ID?.trim();
  let q = sb.from("applications").select("id, job_id, resume_doc_id, cover_doc_id, answers").eq("status", "assisted_pending").order("approved_at", { ascending: true }).limit(limit);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw error;
  const apps = (data ?? []) as AppRow[];
  if (!apps.length) { say("Nothing is waiting. Approve applications in the dashboard first (they appear here as \"assisted\")."); rl.close(); return; }
  say(`${apps.length} application(s) are waiting. A browser window will open; sign in to each portal there the first time (your session is kept in a local profile).`);

  const profileDir = process.env.ASSIST_PROFILE_DIR || join(homedir(), ".career-agent", "browser");
  mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.ASSIST_HEADLESS === "1", viewport: null, executablePath: process.env.CHROMIUM_PATH || undefined,
    channel: process.env.ASSIST_CHANNEL || undefined, // e.g. "chrome" to use your installed Chrome
  });
  await context.addInitScript({ content: "window.__name = window.__name || function (t) { return t; };" });
  let done = 0;
  try {
    for (const [i, app] of apps.entries()) {
      if (i > 0) await sleep(Number(process.env.ASSIST_PAUSE_MS ?? 4000 + Math.random() * 6000));
      const r = await assistOne(sb, context, app, i + 1, apps.length);
      if (r === "done") done++;
      if (r === "quit") break;
    }
  } finally {
    await context.close().catch(() => undefined);
    rl.close();
  }
  say(`\nFinished. ${done} application(s) recorded as submitted.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
