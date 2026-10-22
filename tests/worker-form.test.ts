import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { clickSubmit, fillForm, looksLikeSearchForm } from "../worker/form";
import { leaveJobBoard } from "../worker/assist-lib";
import { CONFIRMATION } from "../worker/match";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
const dir = mkdtempSync(join(tmpdir(), "ca-"));
const resumePath = join(dir, "resume.docx");
const fixture = (hash = "", name = "greenhouse-like") => pathToFileURL(join(process.cwd(), `tests/fixtures/${name}.html`)).href + hash;

const ctx = {
  applicant: { name: "Asha Rao Nair", email: "a@x.com", phone: "+91 90000 00000", location: "Bengaluru", links: ["https://linkedin.com/in/asha"] },
  answers: [
    { question: "Expected CTC", answer: "32 LPA" },
    { question: "Are you legally authorised to work in India?", answer: "Yes" },
    { question: "Are you willing to relocate?", answer: "No" },
  ],
  resumePath,
};

beforeAll(async () => {
  writeFileSync(resumePath, "dummy");
  try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; }
});
afterAll(async () => { await browser?.close(); });

describe.skipIf(!executablePath)("fillForm against a Greenhouse-like fixture", () => {
  it("fills everything it can answer, submits, and sees the confirmation", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture());
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual([]);
    expect(await page.inputValue("#fn")).toBe("Asha");
    expect(await page.inputValue("#ln")).toBe("Rao Nair");
    expect(await page.inputValue("#ctc")).toBe("32 LPA");
    expect(await page.inputValue("#auth")).toBe("1");
    expect(await page.isChecked('input[name="q3"][value="n"]')).toBe(true);
    expect(await page.inputValue("#why")).toBe(""); // optional + no answer: left blank, not invented
    // every value that was entered is recorded with where it came from
    const byLabel = Object.fromEntries(r.entries.map((e) => [e.label, e]));
    expect(r.entries.length).toBe(r.filled.length);
    expect(r.entries).toContainEqual({ label: "First Name", value: "Asha", kind: "text", source: "profile" });
    expect(r.entries.find((e) => e.kind === "text" && e.value === "32 LPA")).toMatchObject({ source: "answers" });
    expect(r.entries.find((e) => e.kind === "file")).toMatchObject({ value: "resume.docx", source: "upload" });
    expect(Object.values(byLabel).every((e) => e.value.length > 0)).toBe(true);
    expect(await clickSubmit(page)).toBe(true);
    await page.waitForFunction(() => document.body.innerText.includes("Thank you"));
    expect(CONFIRMATION.test(await page.innerText("body"))).toBe(true);
    await page.close();
  });

  it("ticks a required privacy-policy agreement and records it", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#consent"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual([]);
    expect(r.entries.some((e) => e.kind === "checkbox" && /privacy policy/i.test(e.label))).toBe(true);
    expect(await page.locator('input[type="checkbox"]').first().isChecked()).toBe(true);
    await page.close();
  });

  it("reports required questions it cannot answer instead of guessing", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#unknown"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual(["Name your favourite sorting algorithm"]);
    expect(r.pending).toEqual([{ label: "Name your favourite sorting algorithm", type: "text", options: [], required: true }]);
    expect(await page.inputValue("#q9")).toBe("");
    await page.close();
  });
});

describe.skipIf(!executablePath)("other employers' form shapes", () => {
  const lever = { ...ctx, applicant: { ...ctx.applicant, currentCompany: "Acme Pay" } };
  it("fills a Lever-style form (wrapping labels, full name, hidden file input) and submits", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "lever-like"));
    const r = await fillForm(page, lever);
    expect(r.unanswered).toEqual([]);
    expect(await page.inputValue('input[name="name"]')).toBe("Asha Rao Nair");
    expect(await page.inputValue('input[name="email"]')).toBe("a@x.com");
    expect(await page.inputValue('input[name="org"]')).toBe("Acme Pay");
    expect(await page.inputValue('input[name="urls[LinkedIn]"]')).toBe("https://linkedin.com/in/asha");
    expect(await page.inputValue('input[name="cards[1][field0]"]')).toBe("32 LPA");
    expect(r.entries.some((e) => e.kind === "file")).toBe(true);
    expect(await clickSubmit(page)).toBe(true);
    await page.waitForFunction(() => document.body.innerText.includes("Application submitted"));
    expect(CONFIRMATION.test(await page.innerText("body"))).toBe(true);
    await page.close();
  });

  it("hands back a visa-sponsorship question that has no saved sponsorship answer (it must not borrow the authorisation answer)", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#sponsor", "lever-like"));
    const r = await fillForm(page, lever);
    expect(r.unanswered.join("|")).toMatch(/visa sponsorship/);
    expect(await page.inputValue('input[name="cards[2][field0]"]')).toBe("");
    await page.close();
  });

  it("hands back an authorisation question about a country the saved answer was not written for", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#india", "lever-like"));
    const sg = { ...lever, answers: [...lever.answers.filter((a) => !/authori/.test(a.question)), { question: "Are you legally authorised to work in Singapore?", answer: "Yes" }] };
    const r = await fillForm(page, sg);
    expect(r.unanswered.join("|")).toMatch(/authorised to work in India/);
    await page.close();
  });

  it("does not pretend to handle a custom combobox: the required field is reported", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "greenhouse-combobox"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered.join("|")).toMatch(/Country/);
    await page.close();
  });

  it("a job page with only an Apply button yields no fields, so the worker has nothing to submit", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "job-page-only"));
    const r = await fillForm(page, ctx);
    expect(r.entries).toEqual([]);
    await page.close();
  });

  it("prefers the form's own submit button over a page-level Apply button", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.setContent('<a role="button" id="cta" onclick="document.title=\'cta\'">Apply now</a><form onsubmit="event.preventDefault();document.title=\'submitted\'"><input name="a"><button type="submit">Send</button></form>');
    expect(await clickSubmit(page)).toBe(true);
    expect(await page.title()).toBe("submitted");
    await page.close();
  });
});

describe.skipIf(!executablePath)("looksLikeSearchForm", () => {
  it("recognises a job board's search page, so nothing is typed into it", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "job-board-search"));
    expect(await looksLikeSearchForm(page)).toBe(true);
    await page.close();
  });
  it("does not mistake a real application form for a search page", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture());
    expect(await looksLikeSearchForm(page)).toBe(false);
    await page.close();
  });
  it("still sees an application form when the page also has a search box in its header", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.setContent(`<form role="search"><input type="search" name="q"><button>Search</button></form>
      <form action="/apply"><input name="a"><input name="b"><input name="c"><button type="submit">Submit application</button></form>`);
    expect(await looksLikeSearchForm(page)).toBe(false);
    await page.close();
  });
  it("is false on a page with no forms at all", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.setContent("<h1>Closed</h1>");
    expect(await looksLikeSearchForm(page)).toBe(false);
    await page.close();
  });
});

const isBoard = (url: string) => /board-/.test(url);

describe.skipIf(!executablePath)("leaveJobBoard", { timeout: 45_000 }, () => {
  it("closes the pop-up and follows the Apply link to the employer's page", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "board-listing"));
    const r = await leaveJobBoard(page, isBoard);
    expect(r.left).toBe(true);
    expect(r.page.url()).toContain("employer.html");
    expect(await looksLikeSearchForm(r.page)).toBe(false);
    await page.close();
  });
  it("follows an Apply button that opens the employer in a new tab", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture("", "board-popup-button"));
    const r = await leaveJobBoard(page, isBoard);
    expect(r.left).toBe(true);
    expect(r.page.url()).toContain("employer.html");
    await context.close();
  });
  it("says so when the page never leaves the job board", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.setContent("<h1>Listing</h1><p>No way to apply here.</p>");
    await page.goto(fixture("", "board-popup-button"));
    await page.evaluate(() => document.getElementById("go")?.remove());
    const r = await leaveJobBoard(page, isBoard);
    expect(r.left).toBe(false);
    await page.close();
  });
  it("does nothing on a page that is not a job board", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture());
    const r = await leaveJobBoard(page, isBoard);
    expect(r).toEqual({ page, left: true });
    await page.close();
  });
});

describe.skipIf(!executablePath)("consent boxes hidden behind a styled box", { timeout: 30_000 }, () => {
  it("are still ticked", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("", "consent-hidden"));
    const r = await fillForm(page, ctx);
    expect(await page.isChecked("#c")).toBe(true);
    expect(r.unanswered).toEqual([]);
    await page.close();
  });
});
