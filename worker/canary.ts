/**
 * Weekly live dry run. Opens a few real, recent postings on each automatic apply system, fills the form with made-up
 * details and a blank resume, and reports whether the form could still be opened and understood. It NEVER presses
 * submit and sends nothing to any employer; it reads public job pages only.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { sendTelegram } from "../src/lib/notify";
import { openApplyForm } from "./assist-lib";
import { judge, pickProbes, report, type CanaryProbe } from "./canary-lib";
import { fillForm } from "./form";

async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const { data, error } = await sb.from("jobs").select("url").gte("found_at", since).order("found_at", { ascending: false }).limit(400);
  if (error) throw new Error(`could not read recent jobs: ${error.message}`);
  const targets = pickProbes((data ?? []).map((r: { url: string }) => r.url));
  const dir = mkdtempSync(join(tmpdir(), "canary-"));
  const resumePath = join(dir, "resume.pdf");
  writeFileSync(resumePath, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

  const browser = await chromium.launch();
  const probes: CanaryProbe[] = [];
  for (const t of targets) {
    const page = await browser.newPage();
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const opened = await openApplyForm(page);
      await page.waitForTimeout(1500);
      const r = await fillForm(page, { applicant: { name: "Test Candidate", email: "test.candidate@example.com", phone: "+10000000000", location: "Test City", links: [] }, answers: [], resumePath });
      probes.push({ ats: t.ats, url: t.url, opened, fields: r.entries.length });
      console.log(`${t.ats}: ${opened}, ${r.entries.length} field(s) filled`);
    } catch (e) {
      probes.push({ ats: t.ats, url: t.url, opened: "error", fields: 0, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      console.log(`${t.ats}: error ${probes[probes.length - 1].error}`);
    } finally { await page.close().catch(() => undefined); }
  }
  await browser.close();
  const verdicts = judge(probes);
  const text = report(verdicts);
  console.log(text);
  const broken = verdicts.some((v) => v.broken);
  // quiet when healthy; speak up when something broke
  if (broken) await sendTelegram(text);
  await sb.from("activity_log").insert({ kind: "canary.run", level: broken ? "warn" : "info", message: text.slice(0, 2000), detail: { probes: probes.map(({ ats, opened, fields, error }) => ({ ats, opened, fields, error })) } });
  if (broken) process.exitCode = 1;
}

main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
