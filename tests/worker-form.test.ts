import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { clickSubmit, fillForm } from "../worker/form";
import { CONFIRMATION } from "../worker/match";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
const dir = mkdtempSync(join(tmpdir(), "ca-"));
const resumePath = join(dir, "resume.docx");
const fixture = (hash = "") => pathToFileURL(join(process.cwd(), "tests/fixtures/greenhouse-like.html")).href + hash;

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

  it("refuses to proceed when a required consent box needs the human", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#consent"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered.join("|")).toMatch(/privacy policy.*tick this yourself/);
    await page.close();
  });

  it("reports required questions it cannot answer instead of guessing", async () => {
    if (!browser) throw new Error("Chromium failed to launch");
    const page = await browser.newPage();
    await page.goto(fixture("#unknown"));
    const r = await fillForm(page, ctx);
    expect(r.unanswered).toEqual(["Name your favourite sorting algorithm"]);
    expect(await page.inputValue("#q9")).toBe("");
    await page.close();
  });
});
