/**
 * Apply worker: runs on GitHub Actions (.github/workflows/apply.yml for one application, pipeline.yml for a batch).
 * It only submits when the application was explicitly approved in the dashboard, never touches CAPTCHAs,
 * checkpoints or consent checkboxes, and hands the application back to you whenever it is unsure.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { confirmationSnippet, type FieldEntry, type SubmissionRecord } from "../src/lib/apply/submission";
import { MasterProfile } from "../src/lib/types";
import { clickSubmit, fillForm } from "./form";
import { CONFIRMATION, detectBlock, type Answer } from "./match";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Central activity log. Never throws: a logging problem must not change the outcome of an application. */
async function logAct(sb: SupabaseClient, e: Record<string, unknown>) {
  try {
    const { error } = await sb.from("activity_log").insert({ level: "info", detail: {}, ...e });
    if (error) console.error(`[activity] could not record ${String(e.kind)}: ${error.message} :: ${JSON.stringify(e).slice(0, 1000)}`);
  } catch (err) {
    console.error(`[activity] could not record ${String(e.kind)}: ${err instanceof Error ? err.message : err} :: ${JSON.stringify(e).slice(0, 1000)}`);
  }
}

async function notify(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text }) }).catch(() => undefined);
}
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

/** Update an application with its submission record; if the database has not been upgraded yet, save the status without it. */
async function updateApplication(sb: SupabaseClient, appId: string, patch: Record<string, unknown>, submission: SubmissionRecord) {
  const { error } = await sb.from("applications").update({ ...patch, submission }).eq("id", appId);
  if (!error) return;
  if (/submission|schema cache|column/i.test(error.message)) {
    console.error(`[submission] stored without the record (database update pending): ${error.message}`);
    const { error: e2 } = await sb.from("applications").update(patch).eq("id", appId);
    if (e2) throw e2;
    return;
  }
  throw error;
}
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

class Handback extends Error {
  constructor(public kind: "needs_input" | "failed", message: string, public stopLinkedIn = false) { super(message); }
}

/**
 * Submit one approved application. A problem with this application (a missing document, a crash) marks it failed with
 * the reason and never stops the rest of the batch.
 */
async function processOne(sb: SupabaseClient, appId: string) {
  try {
    await processInner(sb, appId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`failed: ${message}`);
    process.exitCode = 1;
    // only if it is still ours: an application that already finished is never overwritten
    const { data } = await sb.from("applications").update({ status: "failed", error: message }).eq("id", appId).eq("status", "submitting").select("id, job_id");
    if (data?.length) {
      await sb.from("apply_events").insert({ application_id: appId, kind: "failed", detail: { message } });
      await logAct(sb, { kind: "application.failed", level: "error", message: `Automatic submission failed: ${message}`, status: "failed", application_id: appId, job_id: data[0].job_id, detail: { method: "automated", message } });
    }
  }
}

async function processInner(sb: SupabaseClient, appId: string) {
  const event = async (kind: string, detail: Record<string, unknown> = {}) => { await sb.from("apply_events").insert({ application_id: appId, kind, detail }); };

  // Atomic claim: if another run already took it, or it is not approved, do nothing.
  const { data: claimed, error: claimErr } = await sb.from("applications").update({ status: "submitting", error: null }).eq("id", appId).eq("status", "approved").eq("method", "automated").select("id, job_id, resume_doc_id, cover_doc_id, answers");
  if (claimErr) throw claimErr;
  if (!claimed?.length) { console.log("Application is not in 'approved' automated state; nothing to do."); return; }
  const app = claimed[0];
  await event("worker_started");

  const { data: job } = await sb.from("jobs").select("*").eq("id", app.job_id).single();
  const { data: profileRow } = await sb.from("profile").select("data").eq("id", 1).single();
  const profile = MasterProfile.parse(profileRow?.data ?? {});
  const { data: docs } = await sb.from("documents").select("id,kind,storage_path").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean));
  if (!job || !docs?.length) throw new Handback("failed", "Job or documents missing");

  const dir = mkdtempSync(join(tmpdir(), "apply-"));
  const download = async (path: string, name: string) => {
    const { data, error } = await sb.storage.from("documents").download(path);
    if (error || !data) throw new Handback("failed", `Could not download ${path}: ${error?.message}`);
    const file = join(dir, name);
    writeFileSync(file, Buffer.from(await data.arrayBuffer()));
    return file;
  };
  const resumeDoc = docs.find((d) => d.kind === "resume");
  const coverDoc = docs.find((d) => d.kind === "cover_letter");
  const resumePath = await download(resumeDoc!.storage_path, `Resume${extname(resumeDoc!.storage_path) || ".docx"}`);
  const coverPath = coverDoc ? await download(coverDoc.storage_path, "Cover-Letter.docx") : undefined;

  const applicant = {
    name: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone, location: profile.basics.location,
    links: profile.basics.links, currentCompany: profile.experience[0]?.company,
  };
  const ctx = { applicant, answers: (app.answers as Answer[]) ?? [], resumePath, coverPath };

  // Everything below is recorded so the application page can show exactly what was sent.
  let baselineConfirmation = false;
  const startedAt = new Date().toISOString();
  const entered: FieldEntry[] = [];
  let steps = 0;
  const unansweredNow: string[] = [];
  const fileInfo = (role: "resume" | "cover_letter", path: string, doc: { storage_path: string } | undefined) =>
    ({ role, name: basename(path), bytes: statSync(path).size, sha256: sha256(path), storage_path: doc?.storage_path ?? null });
  const record = (outcome: SubmissionRecord["outcome"], p: { finalUrl: string | null; confirmation: SubmissionRecord["confirmation"]; error: string | null }): SubmissionRecord => ({
    version: 1, method: "automated", outcome, started_at: startedAt, finished_at: new Date().toISOString(), target_url: job.url, final_url: p.finalUrl,
    fields: entered, files: [fileInfo("resume", resumePath, resumeDoc), ...(coverPath ? [fileInfo("cover_letter", coverPath, coverDoc)] : [])],
    unanswered: unansweredNow, confirmation: p.confirmation, error: p.error, steps, note: null,
  });

  const linkedin = job.apply_type === "linkedin";
  let storageStatePath: string | undefined;
  if (linkedin) {
    const state = process.env.LINKEDIN_STORAGE_STATE;
    const { data: capsRow } = await sb.from("settings").select("value").eq("key", "caps").maybeSingle();
    if (capsRow && (capsRow.value as { linkedin_automation_enabled?: boolean }).linkedin_automation_enabled === false) throw new Handback("needs_input", "LinkedIn automation is switched off; apply manually");
    if (!state) throw new Handback("needs_input", "LinkedIn automation needs LINKEDIN_STORAGE_STATE (your own signed-in session); apply manually instead");
    storageStatePath = join(dir, "li-state.json");
    writeFileSync(storageStatePath, state);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let page: Page | undefined;
  try {
    const context = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1280, height: 1800 } });
    // tsx compiles with "keep names", which wraps functions in a __name() helper that does not exist inside the page
    // and breaks every page.evaluate(). Defining it as a no-op makes the injected code run.
    await context.addInitScript({ content: "window.__name = window.__name || function (t) { return t; };" });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    let target = job.url;
    if (job.apply_type === "lever" && !/\/apply\/?$/.test(target)) target = target.replace(/\/$/, "") + "/apply";
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await event("page_loaded", { url: page.url() });

    const checkBlock = async () => {
      const captcha = (await page!.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').count()) > 0;
      const body = await page!.innerText("body").catch(() => "");
      const b = detectBlock(page!.url(), body, captcha);
      if (b === "checkpoint") throw new Handback("needs_input", "LinkedIn showed a security checkpoint. Automation has been switched off; apply manually.", true);
      if (b) throw new Handback("needs_input", `Page requires ${b === "captcha" ? "a CAPTCHA" : "a login"}; please submit this one yourself.`);
    };
    await checkBlock();

    if (linkedin) {
      await page.getByRole("button", { name: /easy apply/i }).first().click().catch(() => { throw new Handback("needs_input", "No Easy Apply button; this job applies on the employer's site"); });
      for (let step = 0; step < 8; step++) {
        await checkBlock();
        const r = await fillForm(page, ctx);
        entered.push(...r.entries); steps++;
        if (r.unanswered.length) { unansweredNow.push(...r.unanswered); throw new Handback("needs_input", `Needs you: ${r.unanswered.join("; ")}`); }
        const submit = page.getByRole("button", { name: /submit application/i });
        if (await submit.isVisible().catch(() => false)) { await submit.click(); break; }
        const next = page.getByRole("button", { name: /^(next|review|continue)/i }).first();
        if (!(await next.isVisible().catch(() => false))) throw new Handback("needs_input", "Could not find the next Easy Apply step");
        await next.click();
        if (step === 7) throw new Handback("needs_input", "Easy Apply has more steps than expected");
      }
    } else {
      const r = await fillForm(page, ctx);
      entered.push(...r.entries); steps++;
      await event("form_filled", { filled: r.filled, unanswered: r.unanswered });
      if (r.unanswered.length) { unansweredNow.push(...r.unanswered); throw new Handback("needs_input", `Needs you: ${r.unanswered.join("; ")}`); }
      // never press a button on a page that has no form: it would be a "job description" page, a login wall or a closed role
      if (r.entries.length === 0) throw new Handback("needs_input", "No application form was found on this page (it may need a sign-in, or the role may be closed); apply on the employer's site");
      await checkBlock();
      baselineConfirmation = CONFIRMATION.test(await page.innerText("body").catch(() => ""));
      if (!(await clickSubmit(page))) throw new Handback("needs_input", "Could not find a submit button");
    }

    // If the page already contained confirmation-like text before pressing submit (a footer, a "thank you for your interest"),
    // that text proves nothing: also require the form itself to be gone.
    await page.waitForFunction(({ src, needFormGone }) => {
      const text = new RegExp(src, "i").test(document.body.innerText);
      if (!text) return false;
      if (!needFormGone) return true;
      return ![...document.querySelectorAll("form input:not([type=hidden]), form textarea, form select")].some((el) => (el as HTMLElement).offsetParent !== null);
    }, { src: CONFIRMATION.source, needFormGone: baselineConfirmation }, { timeout: 25_000 })
      .catch(() => { throw new Handback("needs_input", "Pressed submit, but no confirmation message was detected; check your email or the employer site before retrying"); });

    const shot = `screenshots/${appId}/confirmation.png`;
    await sb.storage.from("documents").upload(shot, await page.screenshot({ fullPage: true }), { contentType: "image/png", upsert: true });
    const now = new Date().toISOString();
    const confirmation = { text: confirmationSnippet(await page.innerText("body").catch(() => ""), CONFIRMATION), screenshot: shot };
    await updateApplication(sb, appId, { status: "submitted", submitted_at: now, lifecycle: "applied", screenshot_path: shot }, record("submitted", { finalUrl: page.url(), confirmation, error: null }));
    await sb.from("jobs").update({ status: "applied" }).eq("id", job.id);
    await event("submitted", { url: page.url() });
    await logAct(sb, { kind: "application.submitted", message: `Submitted automatically: ${job.title} at ${job.company}`, status: "submitted", application_id: appId, job_id: job.id, company: job.company, country: (job as { country?: string }).country ?? null, portal: (job as { portal?: string }).portal ?? job.apply_type, detail: { method: "automated", url: page.url(), screenshot: shot } });
    await notify(`Applied: ${job.title} at ${job.company}`);
    console.log("Submitted.");
  } catch (e) {
    const h = e instanceof Handback ? e : new Handback("failed", e instanceof Error ? e.message : String(e));
    let shot: string | undefined;
    if (page) {
      shot = `screenshots/${appId}/last-state.png`;
      await sb.storage.from("documents").upload(shot, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)), { contentType: "image/png", upsert: true }).catch(() => undefined);
    }
    await updateApplication(sb, appId, { status: h.kind, error: h.message, screenshot_path: shot ?? null }, record(h.kind, { finalUrl: page?.url() ?? null, confirmation: null, error: h.message })).catch((err) => console.error("could not save the submission record:", err));
    await event(h.kind, { message: h.message });
    await logAct(sb, { kind: h.kind === "failed" ? "application.failed" : "application.needs_input", level: h.kind === "failed" ? "error" : "warn", message: `${h.kind === "failed" ? "Automatic submission failed" : "Needs you"}: ${h.message}`, status: h.kind, application_id: appId, job_id: job.id, company: job.company, country: (job as { country?: string }).country ?? null, portal: (job as { portal?: string }).portal ?? job.apply_type, detail: { method: "automated", message: h.message, screenshot: shot ?? null } });
    if (h.stopLinkedIn) await switchOffLinkedIn(sb);
    await notify(`${h.kind === "failed" ? "Application failed" : "Needs you"}: ${h.message}`);
    console.error(`${h.kind}: ${h.message}`);
    if (h.kind === "failed") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function switchOffLinkedIn(sb: SupabaseClient) {
  const { data } = await sb.from("settings").select("value").eq("key", "caps").maybeSingle();
  await sb.from("settings").upsert({ key: "caps", value: { ...(data?.value ?? {}), linkedin_automation_enabled: false }, updated_at: new Date().toISOString() });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * With APPLICATION_ID: submit that one application (the Approve button).
 * Without it: submit every approved automated application, oldest first, up to MAX_APPLY (default 10), with a pause
 * between them so the pace looks like a person and each portal sees at most one request stream.
 */
async function main() {
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const single = process.env.APPLICATION_ID?.trim();
  if (single) {
    if (!UUID.test(single)) throw new Error("APPLICATION_ID is not a uuid");
    await processOne(sb, single);
    return;
  }
  const limit = Math.max(1, Math.min(50, Number(process.env.MAX_APPLY ?? 10) || 10));
  const { data, error } = await sb.from("applications").select("id").eq("status", "approved").eq("method", "automated").order("approved_at", { ascending: true }).limit(limit);
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.id as string);
  console.log(ids.length ? `${ids.length} approved application(s) to submit.` : "No approved applications are waiting.");
  for (const [i, id] of ids.entries()) {
    if (i > 0) await sleep(Number(process.env.APPLY_PAUSE_MS ?? 20_000 + Math.random() * 40_000));
    await processOne(sb, id);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
