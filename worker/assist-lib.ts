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
