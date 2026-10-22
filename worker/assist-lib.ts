import type { Page } from "playwright";

/**
 * Page helpers for the local assist runner (worker/assist.ts). They move through an application form on the way to the
 * final step, and they NEVER press the button that sends the application: that is always your click.
 */

/** Buttons and links that open an application ("Easy Apply", "Apply now", "Apply"). Already-applied states are excluded. */
const APPLY_ENTRY = /\b(easy apply|quick apply|apply now|apply for (this )?job|apply to (this )?job|i'?m interested)\b|^\s*apply\s*$/i;
const NOT_APPLY = /applied|application status|saved|save job|follow|share|report/i;
/** Steps that only move forward inside a multi-step form. */
const NEXT_STEP = /^\s*(next|continue|review|save (and|&) continue|continue to next step|review your application)\s*$/i;
/** The control that sends the application. Used to recognise the final step; it is never clicked here. */
export const SENDS_APPLICATION = /^\s*(submit( application)?|send application|apply|finish|submit and apply)\s*$/i;

const FIELD = 'input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]), textarea, select';

export async function formIsOpen(page: Page): Promise<boolean> {
  const n = await page.locator(FIELD).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length).catch(() => 0);
  return n >= 2;
}

/** Open the application form when the page shows a job description with an apply button. */
export async function openApplyForm(page: Page): Promise<"already" | "clicked" | "none"> {
  if (await formIsOpen(page)) return "already";
  const candidates = [page.getByRole("button", { name: APPLY_ENTRY }), page.getByRole("link", { name: APPLY_ENTRY })];
  for (const c of candidates) {
    const n = Math.min(await c.count().catch(() => 0), 6);
    for (let i = 0; i < n; i++) {
      const el = c.nth(i);
      const name = ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label").catch(() => "")) || "").trim();
      if (NOT_APPLY.test(name)) continue;
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click({ timeout: 5000 }).catch(() => undefined);
      return "clicked";
    }
  }
  return "none";
}

/** Press a forward-only button ("Next", "Continue", "Review"). Returns false when there is none (the last step, or a single-page form). */
export async function nextStep(page: Page): Promise<boolean> {
  const btn = page.getByRole("button", { name: NEXT_STEP }).first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click({ timeout: 5000 }).catch(() => undefined);
  return true;
}

/** True when the page offers the control that sends the application (so you can review and press it yourself). */
export async function finalStepVisible(page: Page): Promise<boolean> {
  const byRole = page.getByRole("button", { name: SENDS_APPLICATION }).first();
  if (await byRole.isVisible().catch(() => false)) return true;
  return page.locator('form input[type="submit"], form button[type="submit"]').first().isVisible().catch(() => false);
}

/** Overlays that sit on top of a job board's page (cookie notices, sign-up or alert pop-ups) and swallow clicks. Closed quietly; none is required. */
async function dismissOverlays(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  const closers = [page.locator(".mfp-close, [data-dismiss], button[aria-label*='close' i], button[title*='close' i]"), page.getByRole("button", { name: /^\s*(accept( all)?|i agree|agree|got it|no,? thanks|not now|close|dismiss)\s*$/i })];
  for (const c of closers) {
    const el = c.first();
    if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1500 }).catch(() => undefined);
  }
}

/**
 * A job found through a job board (Adzuna, Jooble and the like) often opens the board's own listing page, which has no application form:
 * the form is on the employer's site, behind the board's "Apply" link. Close any pop-up, follow that link, and return the page that now
 * shows the employer's site. `left` is false when the page is still on the job board (the apply link was missing or led nowhere).
 */
export async function leaveJobBoard(page: Page, isBoard: (url: string) => boolean): Promise<{ page: Page; left: boolean }> {
  if (!isBoard(page.url())) return { page, left: true };
  await dismissOverlays(page);
  const link = page.locator("a[href*='/land/ad/'], a[href*='/apply']").or(page.getByRole("link", { name: APPLY_ENTRY })).first();
  const href = await link.getAttribute("href", { timeout: 3000 }).catch(() => null);
  if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) {
    const target = new URL(href, page.url()).href;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    if (!isBoard(page.url())) return { page, left: true };
  }
  // the link may open the employer's site in a new tab, or only act on a click
  const btn = page.getByRole("button", { name: APPLY_ENTRY }).or(page.getByRole("link", { name: APPLY_ENTRY })).first();
  if (!(await btn.isVisible().catch(() => false))) return { page, left: !isBoard(page.url()) };
  const opened = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await btn.click({ timeout: 5000, force: true }).catch(() => undefined);
  const next = (await opened) ?? page;
  await next.waitForLoadState("domcontentloaded").catch(() => undefined);
  await next.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  return { page: next, left: !isBoard(next.url()) };
}
