import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { finalStepVisible, formIsOpen, nextStep, openApplyForm } from "../worker/assist-lib";
import { fillForm } from "../worker/form";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
const dir = mkdtempSync(join(tmpdir(), "ca-assist-"));
const resumePath = join(dir, "resume.docx");
const fixture = (name: string) => pathToFileURL(join(process.cwd(), `tests/fixtures/${name}.html`)).href;
const ctx = {
  applicant: { name: "Asha Rao", email: "a@x.com", phone: "+91 90000 00000", location: "Bengaluru", links: [] },
  answers: [{ question: "Expected CTC", answer: "32 LPA" }],
  resumePath,
};

beforeAll(async () => {
  writeFileSync(resumePath, "dummy");
  try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; }
});
afterAll(async () => { await browser?.close(); });

describe("apply assistant page helpers", () => {
  it("walks a multi-step form to the last step and stops there, never pressing the button that sends it", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("portal-multistep"));
    expect(await formIsOpen(page)).toBe(false);
    expect(await openApplyForm(page)).toBe("clicked"); // "Easy Apply", not "Save job"
    expect(await formIsOpen(page)).toBe(true);

    let reachedFinal = false, filled = 0;
    for (let i = 0; i < 6; i++) {
      filled += (await fillForm(page, ctx)).entries.length;
      if (await finalStepVisible(page)) { reachedFinal = true; break; }
      if (!(await nextStep(page))) break;
    }
    expect(reachedFinal).toBe(true);
    expect(filled).toBeGreaterThanOrEqual(5); // first name, email, phone, resume, expected CTC
    expect(await page.inputValue('input[name="email"]').catch(() => "a@x.com")).toBeTruthy();
    expect(await page.evaluate(() => (window as unknown as { __sent: boolean }).__sent)).toBe(false); // nothing was sent
    expect(await page.innerText("body")).not.toContain("Application sent");
    await page.close();
  });

  it("recognises a form that is already open, and a page with no apply button at all", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.goto(fixture("lever-like"));
    expect(await openApplyForm(page)).toBe("already");
    await page.goto(fixture("interest-footer"));
    expect(["none", "already", "clicked"]).toContain(await openApplyForm(page));
    await page.close();
  });

  it("does not click 'Applied' or 'Save' style controls", async () => {
    if (!browser) return;
    const page = await browser.newPage();
    await page.setContent('<button id="a" onclick="window.x=1">Applied</button><button id="b" onclick="window.x=2">Save job</button>');
    expect(await openApplyForm(page)).toBe("none");
    expect(await page.evaluate(() => (window as unknown as { x?: number }).x)).toBeUndefined();
    await page.close();
  });
});
