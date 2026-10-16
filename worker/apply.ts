/**
 * Apply worker: runs on GitHub Actions (see .github/workflows/apply.yml), one application per run.
 * It only submits when the application was explicitly approved in the dashboard, never touches CAPTCHAs,
 * checkpoints or consent checkboxes, and hands the application back to you whenever it is unsure.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { MasterProfile } from "../src/lib/types";
import { clickSubmit, fillForm } from "./form";
import { CONFIRMATION, detectBlock, type Answer } from "./match";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };

class Handback extends Error {
  constructor(public kind: "needs_input" | "failed", message: string, public stopLinkedIn = false) { super(message); }
}

async function main() {
  const appId = need("APPLICATION_ID");
  if (!UUID.test(appId)) throw new Error("APPLICATION_ID is not a uuid");
  const sb = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const event = async (kind: string, detail: Record<string, unknown> = {}) => { await sb.from("apply_events").insert({ application_id: appId, kind, detail }); };

  // Atomic claim: if another run already took it, or it is not approved, do nothing.
  const { data: claimed, error: claimErr } = await sb.from("applications").update({ status: "submitting", error: null }).eq("id", appId).eq("status", "approved").eq("method", "automated").select("id, job_id, resume_doc_id, cover_doc_id, answers");
  if (claimErr) throw claimErr;
  if (!claimed?.length) { console.log("Application is not in 'approved' automated state; nothing to do."); return; }
  const app = claimed[0];
  await event("worker_started");

  const { data: job } = await sb.from("jobs").select("id,title,company,url,apply_type").eq("id", app.job_id).single();
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
  const resumePath = await download(resumeDoc!.storage_path, "Resume.docx");
  const coverPath = coverDoc ? await download(coverDoc.storage_path, "Cover-Letter.docx") : undefined;

  const applicant = {
    name: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone, location: profile.basics.location,
    links: profile.basics.links, currentCompany: profile.experience[0]?.company,
  };
  const ctx = { applicant, answers: (app.answers as Answer[]) ?? [], resumePath, coverPath };

  const linkedin = job.apply_type === "linkedin";
  let storageStatePath: string | undefined;
  if (linkedin) {
    const state = process.env.LINKEDIN_STORAGE_STATE;
    if (!state) throw new Handback("needs_input", "LinkedIn automation needs LINKEDIN_STORAGE_STATE (your own signed-in session); apply manually instead");
    storageStatePath = join(dir, "li-state.json");
    writeFileSync(storageStatePath, state);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let page: Page | undefined;
  try {
    const context = await browser.newContext({ storageState: storageStatePath, viewport: { width: 1280, height: 1800 } });
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
        if (r.unanswered.length) throw new Handback("needs_input", `Needs you: ${r.unanswered.join("; ")}`);
        const submit = page.getByRole("button", { name: /submit application/i });
        if (await submit.isVisible().catch(() => false)) { await submit.click(); break; }
        const next = page.getByRole("button", { name: /^(next|review|continue)/i }).first();
        if (!(await next.isVisible().catch(() => false))) throw new Handback("needs_input", "Could not find the next Easy Apply step");
        await next.click();
        if (step === 7) throw new Handback("needs_input", "Easy Apply has more steps than expected");
      }
    } else {
      const r = await fillForm(page, ctx);
      await event("form_filled", r);
      if (r.unanswered.length) throw new Handback("needs_input", `Needs you: ${r.unanswered.join("; ")}`);
      await checkBlock();
      if (!(await clickSubmit(page))) throw new Handback("needs_input", "Could not find a submit button");
    }

    await page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), CONFIRMATION.source, { timeout: 25_000 })
      .catch(() => { throw new Handback("needs_input", "Submitted, but no confirmation message was detected; check your email or the employer site before retrying"); });

    const shot = `screenshots/${appId}/confirmation.png`;
    await sb.storage.from("documents").upload(shot, await page.screenshot({ fullPage: true }), { contentType: "image/png", upsert: true });
    const now = new Date().toISOString();
    await sb.from("applications").update({ status: "submitted", submitted_at: now, lifecycle: "applied", screenshot_path: shot }).eq("id", appId);
    await sb.from("jobs").update({ status: "applied" }).eq("id", job.id);
    await event("submitted", { url: page.url() });
    console.log("Submitted.");
  } catch (e) {
    const h = e instanceof Handback ? e : new Handback("failed", e instanceof Error ? e.message : String(e));
    let shot: string | undefined;
    if (page) {
      shot = `screenshots/${appId}/last-state.png`;
      await sb.storage.from("documents").upload(shot, await page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)), { contentType: "image/png", upsert: true }).catch(() => undefined);
    }
    await sb.from("applications").update({ status: h.kind, error: h.message, screenshot_path: shot ?? null }).eq("id", appId);
    await event(h.kind, { message: h.message });
    if (h.stopLinkedIn) await switchOffLinkedIn(sb);
    console.error(`${h.kind}: ${h.message}`);
    process.exitCode = h.kind === "failed" ? 1 : 0;
  } finally {
    await browser.close();
  }
}

async function switchOffLinkedIn(sb: SupabaseClient) {
  const { data } = await sb.from("settings").select("value").eq("key", "caps").maybeSingle();
  await sb.from("settings").upsert({ key: "caps", value: { ...(data?.value ?? {}), linkedin_automation_enabled: false }, updated_at: new Date().toISOString() });
}

main().catch((e) => { console.error(e); process.exit(1); });
