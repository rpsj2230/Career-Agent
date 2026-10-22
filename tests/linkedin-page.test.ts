import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { applyButtonsSeen, openApplyForm, parseLinkedinState, passSafetyReminder, waitForLinkedinApply } from "../worker/assist-lib";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
const fixture = (name: string) => pathToFileURL(join(process.cwd(), `tests/fixtures/${name}.html`)).href;
beforeAll(async () => { try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; } });
afterAll(async () => { await browser?.close(); });

describe("what LinkedIn's own words say", () => {
  it("recognises a job you already applied for and a closed one", () => {
    expect(parseLinkedinState("Head of AI\nApplied 5 seconds ago\nSee application")).toEqual({ applied: "Applied 5 seconds ago", closed: false });
    expect(parseLinkedinState("Applied 2 weeks ago").applied).toBe("Applied 2 weeks ago");
    expect(parseLinkedinState("Applied on October 19, 2026").applied).toBe("Applied on October 19, 2026");
    expect(parseLinkedinState("No longer accepting applications").closed).toBe(true);
    expect(parseLinkedinState("We applied our experience. Apply now").applied).toBeNull();
  });
});

describe("the LinkedIn apply button", () => {
  it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH)("finds a company-website Apply link, not only Easy Apply", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-external"));
    expect(await openApplyForm(page)).toBe("clicked");
    expect(await applyButtonsSeen(page)).toContain("Apply on company website");
    await page.close();
  });
  it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH)("waits for the button LinkedIn builds late, then opens Easy Apply", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-easy"));
    expect(await openApplyForm(page)).toBe("none"); // looked too early: nothing yet
    await waitForLinkedinApply(page);
    expect(await openApplyForm(page)).toBe("clicked");
    await page.waitForSelector("#modal:not([hidden])", { timeout: 3000 });
    await page.close();
  });
  it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH)("continues past the safety reminder", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-safety"));
    expect(await openApplyForm(page)).toBe("clicked");
    expect(await passSafetyReminder(page)).toBe(true);
    expect(await page.title()).toBe("left LinkedIn");
    await page.close();
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { EASY_APPLY_SCOPE, formIsOpen, linkedinOpenApply } from "../worker/assist-lib";
import { fillForm } from "../worker/form";

const live = it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH);
describe("opening a LinkedIn application", () => {
  live("does not mistake the site's own search boxes for an application form", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-popup"));
    expect(await formIsOpen(page)).toBe(false);
    await page.close();
  });
  live("opens the company's page in a new tab from 'Apply on company website'", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-popup"));
    const r = await linkedinOpenApply(context, page);
    expect(r.kind).toBe("external");
    expect(r.page.url()).toMatch(/employer\.html$/);
    expect(r.note).toMatch(/new tab/);
    await context.close();
  });
  live("continues past the safety reminder when its button is a link", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-safety-link"));
    const r = await linkedinOpenApply(context, page);
    expect(r.kind).toBe("external");
    expect(r.page.url()).toMatch(/employer\.html$/);
    await context.close();
  });
  live("opens Easy Apply and fills only what is inside its window, never the search boxes", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li-"));
    const resumePath = join(dir, "resume.docx"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-modal"));
    const r = await linkedinOpenApply(context, page);
    expect(r.kind).toBe("easy");
    const result = await fillForm(page, { applicant: { name: "Asha Rao", email: "a@x.com", phone: "+65 9000 0000", location: "Singapore", links: [] }, answers: [], resumePath }, EASY_APPLY_SCOPE);
    expect(result.filled.length).toBe(2);
    expect(await page.inputValue('input[name="email"]')).toBe("a@x.com");
    expect(await page.inputValue('[aria-label="Search by title, skill, or company"]')).toBe("");
    await context.close();
  });
  live("says what happened when the click opens nothing", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent('<button aria-label="Apply on company website">Apply</button>');
    const r = await linkedinOpenApply(context, page);
    expect(r.kind).toBe("none");
    expect(r.note).toMatch(/no new page opened/);
    await context.close();
  }, 30_000);
});

import { accountGatedVendor } from "../worker/assist-lib";
describe("other shapes of LinkedIn's Easy Apply window", () => {
  for (const name of ["linkedin-easy-native", "linkedin-easy-ariamodal"]) {
    live(`finds the window in ${name}`, async () => {
      if (!browser) return;
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(fixture(name));
      const r = await linkedinOpenApply(context, page);
      expect(r.kind).toBe("easy");
      await context.close();
    }, 30_000);
  }
  it("names the employer systems that need an account", () => {
    expect(accountGatedVendor("nine.wd105.myworkdayjobs.com")).toBe("Workday");
    expect(accountGatedVendor("acme.icims.com")).toBe("iCIMS");
    expect(accountGatedVendor("boards.greenhouse.io")).toBeNull();
  });
});

import { describePage } from "../worker/assist-lib";
describe("the probe's description of a page", () => {
  live("lists the window's questions and buttons without any typed value", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-modal"));
    await linkedinOpenApply(context, page);
    await page.fill('input[name="email"]', "secret@example.com");
    const d = (await describePage(page, EASY_APPLY_SCOPE)) as { url: string; containers: unknown[]; controls: { name?: string; label?: string; text?: string }[] };
    const text = JSON.stringify(d);
    expect(d.controls.some((c) => c.name === "email")).toBe(true);
    expect(d.controls.some((c) => c.label === "Email address")).toBe(true);
    expect(d.controls.some((c) => c.text === "Next")).toBe(true);
    expect(text).not.toContain("secret@example.com");
    expect(d.containers.length).toBeGreaterThan(0);
    await context.close();
  }, 30_000);
});

import { buttonsShown, fingerprint, stallProblems, windowText, linkedinSessionAlive, linkedinSignedOutView, finalStepVisible, nextStep, refusedFields, uploadEasyApplyResume, walkEasyApply } from "../worker/assist-lib";
import { skillYears } from "../src/lib/apply/skill-years";
import { MasterProfile } from "../src/lib/types";
describe("a real-shaped Easy Apply window: native dialog, four pages", () => {
  live("is found even though a hidden dialog comes earlier on the page, and is read from the visible one", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li2-"));
    const resumePath = join(dir, "resume.docx"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-steps"));
    const r = await linkedinOpenApply(context, page);
    expect(r.kind).toBe("easy");
    const res = await fillForm(page, { applicant: { name: "Asha Rao", email: "a@x.com", phone: "+65 87161454", location: "Singapore", links: [] }, answers: [{ question: "How many years of experience do you have?", answer: "12" }], resumePath }, r.scope);
    expect(res.filled).toEqual([]); // page 1 is already filled by LinkedIn: nothing to type, and the hidden decoy is not read
    expect(res.unanswered).toEqual([]);
    await context.close();
  }, 30_000);
  live("steps through Next and Review inside the window and fills the question page from the answer bank", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li3-"));
    const resumePath = join(dir, "resume.docx"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-steps"));
    const r = await linkedinOpenApply(context, page);
    const ctx = { applicant: { name: "Asha Rao", email: "a@x.com", phone: "+65 87161454", location: "Singapore", links: [] }, answers: [{ question: "How many years of experience do you have?", answer: "12" }], resumePath };
    expect(await nextStep(page, r.scope)).toBe(true); // page 1 to 2
    expect(await nextStep(page, r.scope)).toBe(true); // 2 to 3
    const q = await fillForm(page, ctx, r.scope);
    expect(q.filled).toContain("How many years of experience do you have?");
    expect(await page.inputValue("#yrs")).toBe("12");
    expect(await nextStep(page, r.scope)).toBe(true); // Review
    expect(await finalStepVisible(page, r.scope)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { sent: boolean }).sent)).toBe(false);
    await context.close();
  }, 30_000);
  live("the probe walk records every page and never presses Submit", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-steps"));
    const r = await linkedinOpenApply(context, page);
    const w = await walkEasyApply(page, r.scope!);
    expect(w.pages.length).toBe(4);
    expect(w.stoppedAt).toMatch(/Submit button, which was not pressed/);
    expect(await page.evaluate(() => (window as unknown as { sent: boolean }).sent)).toBe(false);
    await context.close();
  }, 60_000);
});

describe("Easy Apply questions the form asks (resume step, then a question LinkedIn validates)", () => {
  const profile = MasterProfile.parse({ basics: { name: "Asha Rao" }, experience: [{ id: "e1", company: "Verz", title: "Director", start: "2017", end: "Present", bullets: [{ id: "b", text: "Moved delivery to Azure" }] }] });
  const base = { applicant: { name: "Asha Rao", email: "a@x.com", phone: "+65 87161454", location: "Singapore", links: [] } };
  live("uploads the resume written for the job, answers from the profile, and reaches the final step", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li4-"));
    const resumePath = join(dir, "Asha-Rao-Concentrix.pdf"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-questions"));
    const r = await linkedinOpenApply(context, page);
    expect(await nextStep(page, r.scope)).toBe(true); // contact to resume
    expect(await uploadEasyApplyResume(page, r.scope!, resumePath)).toBe("Asha-Rao-Concentrix.pdf");
    expect(await page.textContent("#chosen")).toBe("Asha-Rao-Concentrix.pdf");
    expect(await nextStep(page, r.scope)).toBe(true); // resume to questions
    const q = await fillForm(page, { ...base, answers: [], resumePath, skillYears: (s) => skillYears(profile, s, 2026) }, r.scope);
    expect(q.filled).toEqual(["How many years of work experience do you have with Microsoft Azure?"]);
    expect(await page.inputValue("#q")).toBe("9");
    expect(await nextStep(page, r.scope)).toBe(true); // Review
    expect(await refusedFields(page, r.scope)).toEqual([]);
    expect(await finalStepVisible(page, r.scope)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { sent: boolean }).sent)).toBe(false);
    await context.close();
  }, 40_000);
  live("with no answer for the tool, the question is reported and the form's refusal names it", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li5-"));
    const resumePath = join(dir, "r.pdf"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-questions"));
    const r = await linkedinOpenApply(context, page);
    await nextStep(page, r.scope); await nextStep(page, r.scope);
    const noTool = MasterProfile.parse({ basics: { name: "Asha Rao" }, experience: [] });
    const q = await fillForm(page, { ...base, answers: [], resumePath, skillYears: (s) => skillYears(noTool, s, 2026) }, r.scope);
    expect(q.filled).toEqual([]);
    expect(q.unanswered).toEqual(["How many years of work experience do you have with Microsoft Azure?"]);
    expect(q.pending).toEqual([{ label: "How many years of work experience do you have with Microsoft Azure?", type: "number", options: [], required: true }]);
    await nextStep(page, r.scope); // LinkedIn refuses the empty box
    expect(await refusedFields(page, r.scope)).toEqual(["How many years of work experience do you have with Microsoft Azure?"]);
    await context.close();
  }, 40_000);
  live("an answer saved from the app (in a different wording) is used and typed as a plain number", async () => {
    if (!browser) return;
    const dir = mkdtempSync(join(tmpdir(), "li6-"));
    const resumePath = join(dir, "r.pdf"); writeFileSync(resumePath, "x");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-questions"));
    const r = await linkedinOpenApply(context, page);
    await nextStep(page, r.scope); await nextStep(page, r.scope);
    const q = await fillForm(page, { ...base, answers: [{ question: "Years of experience with Azure", answer: "6 years" }], resumePath }, r.scope);
    expect(q.filled.length).toBe(1);
    expect(await page.inputValue("#q")).toBe("6");
    await context.close();
  }, 40_000);
  live("the probe walk says why it stopped when a question blocks the page", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-questions"));
    const r = await linkedinOpenApply(context, page);
    const w = await walkEasyApply(page, r.scope!);
    expect(w.pages.length).toBe(3);
    expect(w.stoppedAt).toMatch(/a question needs an answer/);
    expect(w.stoppedAt).toMatch(/Microsoft Azure/);
    await context.close();
  }, 60_000);
});

describe("telling a signed-out LinkedIn page from a signed-in one", () => {
  live("a member's page with obfuscated class names is not mistaken for a signed-out page", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-signed-in-obfuscated"));
    expect(await linkedinSignedOutView(page)).toBe(false);
    await page.goto(fixture("linkedin-signed-out"));
    expect(await linkedinSignedOutView(page)).toBe(true);
    await page.close();
  });
  live("the session check follows LinkedIn's own redirect to the sign-in page", async () => {
    if (!browser) return;
    for (const alive of [true, false]) {
      const context = await browser.newContext();
      await context.route("https://www.linkedin.com/**", (route) => {
        const u = route.request().url();
        if (/\/feed\//.test(u)) return alive ? route.fulfill({ status: 200, contentType: "text/html", body: "<title>Feed</title>" }) : route.fulfill({ status: 302, headers: { location: "https://www.linkedin.com/login" } });
        return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Sign in</title>" });
      });
      expect(await linkedinSessionAlive(context)).toBe(alive);
      expect(context.pages().length).toBe(0); // its own tab is closed again
      await context.close();
    }
  }, 30_000);
  live("lists the buttons a stalled form is showing", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("linkedin-easy-questions"));
    await page.click("button[aria-label^='Easy Apply']");
    expect(await buttonsShown(page, EASY_APPLY_SCOPE)).toEqual(["Next"]);
    await page.close();
  });
});

describe("pressing only this job's own Apply button", () => {
  const jobUrl = "https://www.linkedin.com/jobs/view/4480419562/";
  live("skips the Easy Apply links on other jobs' cards and presses the real button", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-split-view"));
    const r = await linkedinOpenApply(context, page, jobUrl);
    expect(r.kind).toBe("easy");
    expect(await page.title()).not.toBe("WRONG JOB OPENED");
    expect(await page.locator("#d").evaluate((d) => (d as HTMLDialogElement).open)).toBe(true);
    await context.close();
  }, 30_000);
  live("presses nothing when the only Easy Apply on the page belongs to another job", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-list-only"));
    const r = await linkedinOpenApply(context, page, jobUrl);
    expect(r.kind).toBe("none");
    expect(r.note).toMatch(/no Easy Apply or company-website button was visible/);
    expect(await page.title()).not.toBe("WRONG JOB OPENED");
    await context.close();
  }, 30_000);
});

describe("a form that will not go on", () => {
  const base = { applicant: { name: "Asha Rao", email: "a@x.com", phone: "1", location: "SG", links: [] }, resumePath: "/dev/null" };
  live("a dropdown left on its prompt is a question to answer, and is answered from the answer bank", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-stall"));
    const r = await linkedinOpenApply(context, page, "https://www.linkedin.com/jobs/view/4476612945/");
    const none = await fillForm(page, { ...base, answers: [] }, r.scope);
    expect(none.unanswered).toEqual(["Are you comfortable with occasional travel?"]);
    expect(none.pending[0].options).toEqual(["Yes", "No"]); // the prompt is not offered as a choice
    const done = await fillForm(page, { ...base, answers: [{ question: "Are you comfortable with occasional travel?", answer: "Yes" }] }, r.scope);
    expect(done.filled).toEqual(["Are you comfortable with occasional travel?"]);
    expect(await page.inputValue("#ok")).toBe("Yes");
    await context.close();
  }, 30_000);
  live("pressing Review on an unanswered page changes the page once (the error), then nothing; the page's own words are reported", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("linkedin-easy-stall"));
    const r = await linkedinOpenApply(context, page, "https://www.linkedin.com/jobs/view/4476612945/");
    const a = await fingerprint(page, r.scope!);
    await nextStep(page, r.scope); await page.waitForTimeout(300);
    const b = await fingerprint(page, r.scope!);
    expect(b).not.toBe(a); // the error appeared
    await nextStep(page, r.scope); await page.waitForTimeout(300);
    expect(await fingerprint(page, r.scope!)).toBe(b); // pressing again changes nothing: stuck
    const probs = await stallProblems(page, r.scope!);
    expect(probs.join(" | ")).toMatch(/Please enter a valid answer/);
    expect(probs.join(" | ")).toMatch(/Are you comfortable with occasional travel\?/);
    await context.close();
  }, 30_000);
});

describe("what a stuck form says, in the browser's own words", () => {
  live("lists a control the browser calls invalid, with its message, and gives the window's text", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(`<dialog open id="d"><h2>Apply to Acme</h2><label for="n">Years of leadership*</label><input id="n" type="number" min="0" max="50" required value="75"><button>Back</button><button>Review</button></dialog>`);
    const problems = await stallProblems(page, "dialog[open]");
    expect(problems.join(" | ")).toMatch(/Years of leadership.*(50|less|smaller|valid)/i);
    expect(await windowText(page, "dialog[open]")).toMatch(/Apply to Acme.*Years of leadership/);
    await context.close();
  });
});
