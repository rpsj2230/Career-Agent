import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { naukriOpenApply, naukriSuccess, parseNaukriState } from "../worker/naukri-lib";

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
let browser: Browser | undefined;
beforeAll(async () => { try { browser = await chromium.launch({ executablePath }); } catch { browser = undefined; } });
afterAll(async () => { await browser?.close(); });
const live = it.skipIf(!process.env.CHROMIUM_PATH && !process.env.PLAYWRIGHT_BROWSERS_PATH);

describe("what a Naukri job page says", () => {
  it("recognises an application already made, a closed role, a sign-in wall and success", () => {
    expect(parseNaukriState("Product Manager\nYou have already applied for this job").applied).toMatch(/already applied/i);
    expect(parseNaukriState("Applied on 12 Oct").applied).toBeNull();
    expect(parseNaukriState("This job is no longer accepting applications").closed).toBe(true);
    expect(parseNaukriState("The job you are looking for is no longer available").closed).toBe(true);
    expect(parseNaukriState("Login to apply").loginWall).toBe(true);
    expect(parseNaukriState("Apply now. Great team, we applied our experience").applied).toBeNull();
    expect(naukriSuccess("You have successfully applied to Product Manager")).toBe(true);
    expect(naukriSuccess("Apply")).toBe(false);
  });
});

const jobPage = (body: string) => `<html><head><title>Product Manager | Naukri</title></head><body>
  <div class="similar-jobs"><article class="card"><a href="/job-listings-other-1">Other job</a><button id="o1" onclick="document.title='WRONG JOB'">Apply</button></article></div>
  <section class="job-header"><h1>Product Manager</h1>${body}</section></body></html>`;

describe("pressing Naukri's Apply for this job", () => {
  live("applies at once and says so, never pressing a similar job's Apply", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(jobPage(`<button id="apply-button" onclick="document.body.insertAdjacentHTML('beforeend','<div role=status>You have successfully applied to Product Manager</div>')">Apply</button>`));
    const r = await naukriOpenApply(context, page);
    expect(r.kind).toBe("applied");
    expect(await page.title()).not.toBe("WRONG JOB");
    await context.close();
  }, 30_000);
  live("opens the follow-up questions the page asks", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(jobPage(`<button onclick="document.getElementById('d').hidden=false">Apply</button><div id="d" class="chatbot-drawer" hidden><p>Are you comfortable with a hybrid model?</p><input aria-label="Your answer"><button>Save</button></div>`));
    const r = await naukriOpenApply(context, page);
    expect(r.kind).toBe("questions");
    await context.close();
  }, 30_000);
  live("follows 'Apply on company site' to the employer's tab", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(jobPage(`<button onclick="window.open('about:blank')">Apply on company site</button>`));
    const r = await naukriOpenApply(context, page);
    expect(r.kind).toBe("external");
    expect(r.page).not.toBe(page);
    await context.close();
  }, 30_000);
  live("reports a sign-in wall", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(jobPage(`<button onclick="document.body.insertAdjacentHTML('beforeend','<form><h3>Login to apply</h3><input type=password aria-label=Password></form>')">Apply</button>`));
    expect((await naukriOpenApply(context, page)).kind).toBe("login");
    await context.close();
  }, 30_000);
  live("says what it saw when there is no Apply button of this job", async () => {
    if (!browser) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(jobPage(`<button>Save</button>`));
    const r = await naukriOpenApply(context, page);
    expect(r.kind).toBe("none");
    expect(r.note).toMatch(/no Apply button/);
    expect(await page.title()).not.toBe("WRONG JOB");
    await context.close();
  }, 30_000);
});
