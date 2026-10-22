import type { BrowserContext, Page } from "playwright";
import { buttonsShown, ownApplyControl } from "./assist-lib";

/**
 * Naukri, read from the page's own words. Built from how Naukri behaves for a signed-in member, without the ability to try it here, so every unexpected outcome is handed back
 * with what the page showed rather than guessed at.
 */
export type NaukriState = { applied: string | null; closed: boolean; loginWall: boolean };

const SUCCESS = /successfully\s+applied|you\s+have\s+successfully\s+applied|application\s+(has\s+been\s+)?(sent|submitted)/i;

/** What the job page says about itself: already applied, closed, or a sign-in wall. Pure. */
export function parseNaukriState(bodyText: string): NaukriState {
  const applied = bodyText.match(/(you\s+have\s+already\s+applied[^.\n]{0,60}|already\s+applied\s+(for|to)\s+this\s+job|you['’]ve\s+(already\s+)?applied[^.\n]{0,40})/i);
  const closed = /this\s+job\s+(is\s+)?(no\s+longer|not)\s+(accepting|available)|job\s+(has\s+)?expired|(position|vacancy)\s+(has\s+been\s+|is\s+)?closed|no\s+longer\s+accepting\s+applications|(the\s+)?job\s+you\s+are\s+looking\s+for\s+is\s+no\s+longer/i.test(bodyText);
  const loginWall = /(login|log\s*in|sign\s*in|register)\s+(or\s+register\s+)?to\s+apply|login\s+to\s+continue|please\s+login/i.test(bodyText);
  return { applied: applied ? applied[0].replace(/\s+/g, " ").trim() : null, closed, loginWall };
}

export const naukriSuccess = (bodyText: string): boolean => SUCCESS.test(bodyText);

export type NaukriOpen =
  | { kind: "applied"; page: Page; note: string }
  | { kind: "questions"; page: Page; note: string; scope: string }
  | { kind: "external"; page: Page; note: string }
  | { kind: "login"; page: Page; note: string }
  | { kind: "none"; page: Page; note: string };

/** Naukri's follow-up questions open in a side panel or dialog: the first visible one. */
export const NAUKRI_QUESTIONS_SCOPE = '[class*="chatbot" i], [class*="drawer" i], [role="dialog"], [aria-modal="true"]';

const INTERNAL = /^\s*apply(\s+now)?\s*$/i;
const EXTERNAL = /apply\s+on\s+company\s+(site|website)|apply\s+on\s+employer|apply\s+externally/i;

/**
 * Press this job's own Apply button and say what happened: applied at once ("You have successfully applied"), follow-up questions to answer, the employer's own site in a new tab,
 * a sign-in wall, or nothing. Controls inside lists of other jobs (similar and recommended jobs) are never pressed.
 */
export async function naukriOpenApply(context: BrowserContext, page: Page): Promise<NaukriOpen> {
  const skip = '[class*="similar" i], [class*="recommend" i], [class*="card" i]:not([class*="job-header" i])';
  const internal = await ownApplyControl(page, INTERNAL, null, skip);
  const external = internal ? null : await ownApplyControl(page, EXTERNAL, null, skip);
  const control = internal ?? external;
  if (!control) return { kind: "none", page, note: `no Apply button of this job was visible (buttons: ${(await buttonsShown(page)).join(" | ") || "none"})` };
  let popped: Page | null = null;
  const popup = context.waitForEvent("page", { timeout: 9000 }).then((p) => { popped = p; return p; }, () => null);
  await control.el.click({ timeout: 5000 }).catch(() => undefined);
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500).catch(() => undefined);
    const text = await page.innerText("body").catch(() => "");
    if (naukriSuccess(text)) return { kind: "applied", page, note: `Naukri says it applied after "${control.name}"` };
    const st = parseNaukriState(text);
    if (st.loginWall && (await page.locator('input[type="password"]:visible').count().catch(() => 0)) > 0) return { kind: "login", page, note: "Naukri showed its sign-in form" };
    const q = page.locator(`${NAUKRI_QUESTIONS_SCOPE} >> visible=true`).first();
    if (await q.locator("input:visible, textarea:visible, select:visible, [role=radio]:visible").count().catch(() => 0)) return { kind: "questions", page, note: `Naukri asked follow-up questions after "${control.name}"`, scope: NAUKRI_QUESTIONS_SCOPE };
    if (popped) { const p: Page = popped; await p.waitForLoadState("domcontentloaded").catch(() => undefined); return { kind: "external", page: p, note: `clicked "${control.name}", the company's page opened in a new tab` }; }
  }
  const late = await popup;
  if (late) { await late.waitForLoadState("domcontentloaded").catch(() => undefined); return { kind: "external", page: late, note: `clicked "${control.name}", the company's page opened in a new tab` }; }
  return { kind: "none", page, note: `clicked "${control.name}" but nothing happened (buttons: ${(await buttonsShown(page)).join(" | ") || "none"})` };
}
