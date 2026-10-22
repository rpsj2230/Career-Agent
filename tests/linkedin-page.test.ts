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
