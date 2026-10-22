import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { destinationTrust, PROGRAM_FILE, sensitiveKind, sensitiveReason } from "../src/lib/apply/safety";
import { cleanQuestion } from "../src/lib/apply/handbacks";
import { classifyHandback } from "../src/lib/handback-reasons";
import { isRetryable } from "../src/lib/apply/auto-retry";
import { AI_TOOL_YEARS, defaultToolYears } from "../src/lib/apply/skill-years";
import { fillForm } from "../worker/form";
import { guardDownloads } from "../worker/assist-lib";
import { skillYears } from "../src/lib/apply/skill-years";
import { MasterProfile } from "../src/lib/types";

describe("fields that ask for a secret", () => {
  it("recognises passwords, payment and identity numbers and codes", () => {
    expect(sensitiveKind("Password*")).toBe("password");
    expect(sensitiveKind("Confirm password")).toBe("password");
    expect(sensitiveKind("Anything", "password")).toBe("password");
    expect(sensitiveKind("Card number")).toBe("payment");
    expect(sensitiveKind("CVV")).toBe("payment");
    expect(sensitiveKind("Aadhaar number")).toBe("identity");
    expect(sensitiveKind("One-time code sent to your email")).toBe("code");
  });
  it("does not mistake a question about a tool or a field for a secret", () => {
    for (const q of ["How many years of experience do you have with payment processing?", "How many years with Swift?", "Years of experience with password managers", "Why do you want this role?", "Email", "Current account manager"]) expect(sensitiveKind(q), q).toBeNull();
  });
  it("is never offered as a question to type an answer to", () => {
    expect(cleanQuestion("Confirm password")).toBeNull();
    expect(cleanQuestion("Password")).toBeNull();
    expect(cleanQuestion("How many years of work experience do you have with Azure?")).not.toBeNull();
  });
  it("has hand-back reasons that are classed as unsafe and never retried", () => {
    for (const k of ["password", "payment", "identity", "code"] as const) {
      const r = sensitiveReason(k, "example.com");
      expect(classifyHandback(r), r).toBe("unsafe");
      expect(isRetryable(r), r).toBe(false);
      expect(r).not.toMatch(/^Needs you:/);
    }
  });
});

describe("is this page the employer's", () => {
  it("accepts known application systems and pages that name the company", () => {
    expect(destinationTrust({ host: "boards.greenhouse.io", title: "Apply", body: "", company: "Acme" }).ok).toBe(true);
    expect(destinationTrust({ host: "infoprolearning.com", title: "Careers | Infopro Learning", body: "Join Infopro Learning", company: "Infopro Learning, Inc" }).ok).toBe(true);
  });
  it("refuses an unrelated page, and any page that reads like a scam, however well it names the company", () => {
    expect(destinationTrust({ host: "fast-jobs-now.xyz", title: "Great offers", body: "Work from home", company: "Acme" }).ok).toBe(false);
    expect(destinationTrust({ host: "acme-careers.xyz", title: "Acme", body: "Acme: pay a registration fee to start", company: "Acme" }).ok).toBe(false);
    expect(destinationTrust({ host: "acme.com", title: "Acme", body: "Download and install our app to continue", company: "Acme" }).ok).toBe(false);
    expect(destinationTrust({ host: "boards.greenhouse.io", title: "Apply", body: "Congratulations, you've won", company: "Acme" }).ok).toBe(false);
  });
  it("names the program files it never follows", () => {
    for (const u of ["https://x.com/setup.exe", "https://x.com/a.dmg?dl=1", "https://x.com/i.pkg", "https://x.com/a.apk"]) expect(PROGRAM_FILE.test(u), u).toBe(true);
    for (const u of ["https://x.com/resume.pdf", "https://x.com/apply"]) expect(PROGRAM_FILE.test(u), u).toBe(false);
  });
});

describe("the owner's default for years with a tool", () => {
  const p = (start: string) => MasterProfile.parse({ basics: { name: "A" }, experience: [{ id: "e", company: "C", title: "T", start, end: "Present", bullets: [] }] });
  it("gives a general tool 12 years, capped at the length of the career, and an AI tool 3", () => {
    expect(defaultToolYears(p("2008"), "machine tools", 2026)).toBe("12");
    expect(defaultToolYears(p("2021"), "learning management systems", 2026)).toBe("5");
    expect(defaultToolYears(MasterProfile.parse({ basics: { name: "A" } }), "excel", 2026)).toBe("10");
    for (const t of ["generative ai", "chatgpt", "llm", "prompt engineering", "machine learning", "langchain"]) expect(defaultToolYears(p("2008"), t, 2026), t).toBe(String(AI_TOOL_YEARS));
    expect(defaultToolYears(p("2008"), "email", 2026)).toBe("12"); // "ai" inside another word is not an AI tool
  });
});

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
beforeAll(async () => { try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; } });
afterAll(async () => { await browser?.close(); });
const live = it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH);

describe("an account-creation form", () => {
  live("is reported as blocked, and no password is typed", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "sf-")); const resumePath = join(dir, "r.pdf"); writeFileSync(resumePath, "x");
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(process.cwd(), "tests/fixtures/account-signup.html")).href);
    const r = await fillForm(page, { applicant: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "SG", links: [] }, answers: [{ question: "Password", answer: "hunter2" }], resumePath });
    expect(r.blocked.map((b) => b.kind)).toEqual(["password", "password"]);
    expect(await page.inputValue("#pw")).toBe("");
    expect(await page.inputValue("#pc")).toBe("");
    expect(r.pending.map((x) => x.label)).toEqual([]); // not offered to the model or to you as a question
    await page.close();
  });
});

describe("a page that offers a file", () => {
  live("has its download cancelled and named, in any tab", async () => {
    if (!browser) return;
    const context = await browser.newContext({ acceptDownloads: false });
    const seen: string[] = [];
    guardDownloads(context, (n) => seen.push(n));
    const page = await context.newPage();
    await page.setContent('<a id="a" download="installer.dmg" href="data:application/octet-stream;base64,AAAA">Download our app</a>');
    await page.click("#a");
    await page.waitForTimeout(800);
    expect(seen).toEqual(["installer.dmg"]);
    const popup = await context.newPage(); // a tab opened later is watched too
    await popup.setContent('<a id="b" download="setup.exe" href="data:application/octet-stream;base64,AAAA">Get it</a>');
    await popup.click("#b");
    await popup.waitForTimeout(800);
    expect(seen).toEqual(["installer.dmg", "setup.exe"]);
    await context.close();
  });
});

describe("the default years rule in a form", () => {
  live("fills a tool the profile cannot back with the owner's default, labelled as a rule, after a saved answer and profile years", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "dy-")); const resumePath = join(dir, "r.pdf"); writeFileSync(resumePath, "x");
    const profile = MasterProfile.parse({ basics: { name: "Asha Rao" }, experience: [{ id: "e", company: "Verz", title: "Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Moved delivery to Azure" }] }] });
    const html = (qs: string[]) => qs.map((q, i) => `<label for="q${i}">${q}*</label><input id="q${i}" required>`).join("");
    const page = await browser.newPage();
    await page.setContent(html(["How many years of work experience do you have with Microsoft Azure?", "How many years of work experience do you have with Machine Tools?", "How many years of work experience do you have with Generative AI?", "How many years of work experience do you have with Kubernetes?"]));
    const r = await fillForm(page, { applicant: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "SG", links: [] }, answers: [{ question: "Years of experience with Kubernetes", answer: "4 years" }], resumePath, skillYears: (s) => skillYears(profile, s, 2026), defaultYears: (s) => defaultToolYears(profile, s, 2026) }, undefined);
    expect(await page.inputValue("#q0")).toBe("14"); // shown by the profile
    expect(await page.inputValue("#q1")).toBe("12"); // the owner's default for a general tool
    expect(await page.inputValue("#q2")).toBe("3"); // the owner's default for an AI tool
    expect(await page.inputValue("#q3")).toBe("4"); // a saved answer wins, written as a number
    expect(r.entries.map((e) => e.source)).toEqual(["profile", "rule", "rule", "answers"]);
    expect(r.unanswered).toEqual([]);
    await page.close();
  });
});

describe("Yes and No boxes under one question", () => {
  const ctx = (answers: { question: string; answer: string }[]) => ({ applicant: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "SG", links: [] }, answers, resumePath: "/dev/null" });
  live("are one question, answered by ticking one box; agreements stay separate", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(process.cwd(), "tests/fixtures/checkbox-questions.html")).href);
    const r = await fillForm(page, ctx([{ question: "Are you legally eligible to work in the UK?", answer: "No" }, { question: "Are you comfortable with travel up to 25%?", answer: "Yes" }]));
    expect(await page.isChecked("#elig-no")).toBe(true);
    expect(await page.isChecked("#elig-yes")).toBe(false);
    expect(await page.isChecked("#trav-yes")).toBe(true);
    expect(await page.isChecked("#terms")).toBe(true); // plain agreements are ticked, each by itself
    expect(await page.isChecked("#priv")).toBe(true);
    expect(await page.isChecked("#vet")).toBe(false); // not an agreement: left to you
    expect(r.unanswered).toEqual(["I am a veteran (a required box that is not a plain agreement)"]);
    await page.close();
  });
  live("with no answer, the question itself is reported with its options, not a bare Yes or No", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(process.cwd(), "tests/fixtures/checkbox-questions.html")).href);
    const r = await fillForm(page, ctx([]));
    expect(r.pending.filter((x) => x.options.length).map((x) => [x.label, x.options])).toEqual([["Are you legally eligible to work in the UK?", ["Yes", "No"]], ["Are you comfortable with travel up to 25%?", ["Yes", "No"]]]);
    expect(r.unanswered).toContain("Are you legally eligible to work in the UK?");
    await page.close();
  });
  it("never offers a lone Yes or No, or the old box wording, as a question", () => {
    expect(cleanQuestion("Yes (a required box that is not a plain agreement)")).toBeNull();
    expect(cleanQuestion("No (a required box that is not a plain agreement)")).toBeNull();
    expect(cleanQuestion("I am a veteran (a required box that is not a plain agreement)")).toBe("I am a veteran");
  });
});

import { staleOldReading } from "../src/lib/apply/assistant-live";
describe("hand-backs an older assistant could not read", () => {
  it("get one more try, once", () => {
    const rows = [
      { id: "a", error: "Needs you: Yes (a required box that is not a plain agreement)" },
      { id: "b", error: "Needs you: Confirm password; Password" },
      { id: "c", error: "Could not reach the final step of the form" },
      { id: "d", error: "Could not reach the final step of the form (stopped on tiktok.com after 2 pages)" },
      { id: "e", error: "Needs you: How many years of work experience do you have with Machine Tools?" },
    ];
    expect(staleOldReading(rows, new Set())).toEqual(["a", "b", "c"]);
    expect(staleOldReading(rows, new Set(["a", "c"]))).toEqual(["b"]);
  });
});
