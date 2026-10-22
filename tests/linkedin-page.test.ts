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
