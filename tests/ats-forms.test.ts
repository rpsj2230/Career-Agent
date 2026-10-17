import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { brokenAts, decideApply, type Attempt } from "@/lib/apply/caps";
import { decideAutoApply } from "@/lib/apply/policy";
import { clickSubmit, fillForm } from "../worker/form";
import { CONFIRMATION } from "../worker/match";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
const dir = mkdtempSync(join(tmpdir(), "ca-ats-"));
const resumePath = join(dir, "resume.docx");
const fixture = (name: string, hash = "") => pathToFileURL(join(process.cwd(), `tests/fixtures/${name}.html`)).href + hash;
const ctx = {
  applicant: { name: "Asha Rao Nair", email: "a@x.com", phone: "+91 90000 00000", location: "Bengaluru", links: [] },
  answers: [{ question: "Expected CTC", answer: "32 LPA" }],
  resumePath,
};
beforeAll(async () => { writeFileSync(resumePath, "dummy"); try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; } });
afterAll(async () => { await browser?.close(); });

describe("Ashby-style and Workable-style forms", () => {
  it("an Ashby-style form is filled, submitted and confirmed", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("ashby-like"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual([]);
    expect(r.entries.map((e) => e.label.replace(/\s*\*$/, ""))).toEqual(expect.arrayContaining(["Name", "Email", "Phone", "Resume", "What is your expected CTC?"]));
    expect(r.entries.find((e) => /name/i.test(e.label))?.value).toBe("Asha Rao Nair");
    expect(await clickSubmit(page)).toBe(true);
    await page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), CONFIRMATION.source);
    await page.close();
  });
  it("a visa-sponsorship question is handed back, never guessed", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("ashby-like", "#sponsor"));
    expect((await fillForm(page, ctx)).unanswered.join(" ")).toMatch(/visa sponsorship/i);
    await page.close();
  });
  it("a Workable-style form is filled with first and last name split, then submitted and confirmed", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("workable-like"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual([]);
    expect(r.entries.find((e) => /first name/i.test(e.label))?.value).toBe("Asha");
    expect(r.entries.find((e) => /last name/i.test(e.label))?.value).toBe("Rao Nair");
    expect(await clickSubmit(page)).toBe(true);
    await page.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), CONFIRMATION.source);
    await page.close();
  });
});

const caps = { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false };
const none = { automatedToday: 0, linkedinAutomatedToday: 0, linkedinAutomatedThisWeek: 0 };

describe("which ATS are applied for automatically", () => {
  it("Greenhouse, Lever, Ashby and Workable are; Recruitee and unknown sites are prepared for you", () => {
    for (const ats of ["greenhouse", "lever", "ashby", "workable"]) expect(decideApply("portal", caps, none, ats).mode, ats).toBe("automated");
    expect(decideApply("portal", caps, none, "recruitee").mode).toBe("assisted");
    expect(decideApply("unknown", caps, none, null).mode).toBe("assisted");
    expect(decideApply("greenhouse", caps, none).mode).toBe("automated"); // the existing behaviour is unchanged
  });
  it("the daily total still applies to them", () => {
    expect(decideApply("portal", caps, { ...none, automatedToday: 15 }, "ashby").allowed).toBe(false);
  });
  it("a schedule approves an Ashby posting automatically only under the usual rules", () => {
    const base = { mode: "scan_prepare_apply" as const, requireApproval: false, verified: true, applyType: "portal" as const, ats: "ashby", caps, capState: none, automatedThisRun: 0, maxApply: 5 };
    expect(decideAutoApply(base)).toMatchObject({ action: "approve", code: "ok" });
    expect(decideAutoApply({ ...base, verified: false })).toMatchObject({ action: "leave", code: "unverified" });
  });
});

describe("pausing an ATS that keeps failing", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const bad = (ats: string, h: number): Attempt => ({ ats, at: at(h), outcome: "bad" });
  it("five technical failures in a row pause that ATS, and only that one", () => {
    const attempts = [1, 2, 3, 5, 8].map((h) => bad("ashby", h)).concat([{ ats: "lever", at: at(2), outcome: "ok" }]);
    expect(brokenAts(attempts, now)).toEqual(["ashby"]);
  });
  it("one success among the last five keeps it running; fewer than five attempts prove nothing", () => {
    expect(brokenAts([bad("ashby", 1), bad("ashby", 2), { ats: "ashby", at: at(3), outcome: "ok" }, bad("ashby", 4), bad("ashby", 5)], now)).toEqual([]);
    expect(brokenAts([1, 2, 3, 4].map((h) => bad("ashby", h)), now)).toEqual([]);
  });
  it("a question the agent had no answer for is not a failure of the ATS", () => {
    const neutral = [1, 2, 3, 4, 5, 6].map((h): Attempt => ({ ats: "workable", at: at(h), outcome: "neutral" }));
    expect(brokenAts(neutral, now)).toEqual([]);
  });
  it("tries again a day after the last failure", () => {
    expect(brokenAts([30, 31, 32, 33, 34].map((h) => bad("ashby", h)), now)).toEqual([]);
  });
  it("a paused ATS is prepared for you, with the reason, instead of submitted", () => {
    const d = decideApply("portal", caps, { ...none, brokenAts: ["ashby"] }, "ashby");
    expect(d).toMatchObject({ allowed: true, mode: "assisted" });
    expect(d.reason).toMatch(/paused/);
    expect(decideApply("portal", caps, { ...none, brokenAts: ["ashby"] }, "workable").mode).toBe("automated");
  });
});
