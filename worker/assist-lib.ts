import type { BrowserContext, Locator, Page } from "playwright";

/**
 * Page helpers for the local assist runner (worker/assist.ts). They move through an application form on the way to the
 * final step, and they NEVER press the button that sends the application: that is always your click.
 */

/** Buttons and links that open an application ("Easy Apply", "Apply now", "Apply"). Already-applied states are excluded. */
const APPLY_ENTRY = /\b(easy apply|quick apply|apply now|apply for (this )?job|apply to (this )?job|apply (on|at|via|through|with) (the )?(company|employer|external)('s)?( career)?( web)?(site| page)?|apply externally|i'?m interested)\b|^\s*apply\s*$/i;
const NOT_APPLY = /applied|application status|saved|save job|follow|share|report/i;
/** Steps that only move forward inside a multi-step form. */
const NEXT_STEP = /^\s*(next|continue|review|save (and|&) continue|continue to next step|review your application)\s*$/i;
/** The control that sends the application. Used to recognise the final step; it is never clicked here. */
export const SENDS_APPLICATION = /^\s*(submit( application)?|send application|apply|finish|submit and apply)\s*$/i;

const FIELD = 'input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]), textarea, select';

export async function formIsOpen(page: Page): Promise<boolean> {
  // the site's own search boxes (a header or navigation bar) are not an application form
  const n = await page.locator(FIELD).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest("header, nav, [role=search], form[role=search], #global-nav, .global-nav, .search-global-typeahead")).length).catch(() => 0);
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
export async function nextStep(page: Page, scope?: string): Promise<boolean> {
  const btn = (scope ? page.locator(`${scope} >> visible=true`).first().getByRole("button", { name: NEXT_STEP }) : page.getByRole("button", { name: NEXT_STEP })).first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  await btn.click({ timeout: 5000 }).catch(() => undefined);
  return true;
}

/**
 * LinkedIn's resume step lists resumes saved from earlier applications, one of them already selected, plus an "Upload resume" button.
 * The résumé written for THIS job must be the one sent, so it is uploaded through that button. Returns the file name when it was
 * uploaded, null when this page has no such button (every other step) or the upload did not go through.
 */
export async function uploadEasyApplyResume(page: Page, scope: string, resumePath: string): Promise<string | null> {
  const root = page.locator(`${scope} >> visible=true`).first();
  const btn = root.getByRole("button", { name: /^\s*upload (a )?(resume|cv)\s*$/i }).first();
  if (!(await btn.isVisible().catch(() => false))) return null;
  const chooser = page.waitForEvent("filechooser", { timeout: 6000 }).catch(() => null);
  await btn.click({ timeout: 4000 }).catch(() => undefined);
  const fc = await chooser;
  if (!fc) return null;
  await fc.setFiles(resumePath).catch(() => undefined);
  const name = resumePath.split(/[\\/]/).pop() ?? resumePath;
  // the page shows the file's name once it has taken it
  const stem = name.replace(/\.[^.]+$/, "").slice(0, 20);
  const shown = await root.getByText(stem, { exact: false }).first().waitFor({ state: "visible", timeout: 12_000 }).then(() => true, () => false);
  return shown ? name : null;
}

/**
 * The questions a form refused: controls the page itself marks invalid ("Invalid input", "Please enter a valid answer").
 * Used after pressing Next to tell a question we answered wrongly, or could not answer, from a page that simply did not move on.
 */
export async function refusedFields(page: Page, scope?: string): Promise<string[]> {
  return page.evaluate((scopeSel) => {
    const shown = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden"; };
    const root: ParentNode = scopeSel ? [...document.querySelectorAll(scopeSel)].find(shown) ?? document : document;
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"], fieldset[aria-invalid="true"]')) {
      if (!shown(el)) continue;
      const by = el.getAttribute("aria-labelledby");
      const label = el.getAttribute("aria-label") || (by ? by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ") : "") || (el.id ? text(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) : "") || text(el.querySelector("legend")) || (el as HTMLInputElement).name || "";
      if (label && !out.includes(label)) out.push(label);
    }
    return out;
  }, scope);
}

/** What the Easy Apply window is showing, as one string: its headings, labels, buttons and messages. It changes when the form moves on, or shows an error. */
export async function fingerprint(page: Page, scope: string): Promise<string> {
  return page.evaluate((sel) => {
    const shown = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e as HTMLElement).visibility !== "hidden"; };
    const root = [...document.querySelectorAll(sel)].find(shown);
    if (!root) return "";
    return [...root.querySelectorAll("h1,h2,h3,legend,label,button,[role=alert],[class*=error i],[class*=feedback i]")].filter(shown).map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).join("|").slice(0, 1200);
  }, scope).catch(() => "");
}

/**
 * Why a form will not go on, in the page's own words: its visible error messages, each with the question it belongs to, and the required
 * boxes that are still empty. Names of questions and messages only: never a value that was typed.
 */
export async function stallProblems(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const shown = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e as HTMLElement).visibility !== "hidden"; };
    const root = [...document.querySelectorAll(sel)].find(shown);
    if (!root) return [] as string[];
    const text = (e: Element | null) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
    const labelNear = (e: Element) => { let up: Element | null = e; for (let i = 0; i < 5 && up; i++) { const l = up.querySelector("label, legend"); if (l && text(l)) return text(l).slice(0, 90); up = up.parentElement; } return ""; };
    const out: string[] = [];
    for (const e of root.querySelectorAll("[role=alert], [class*=error i], [class*=feedback i], [id*=error i]")) {
      const t = text(e);
      if (!shown(e) || !t || t.length > 140 || !/(required|invalid|valid|enter|select|choose|must|please|error|wrong|at least|too)/i.test(t)) continue;
      const lab = labelNear(e);
      const line = lab && !t.includes(lab) ? `${lab}: ${t}` : t;
      if (!out.includes(line)) out.push(line);
    }
    for (const c of root.querySelectorAll<HTMLInputElement>("input, select, textarea")) {
      if (!shown(c) || !(c.required || c.getAttribute("aria-required") === "true")) continue;
      const empty = c.type === "checkbox" || c.type === "radio" ? false : c.tagName === "SELECT" ? !c.value || /^\s*(select|choose)/i.test((c as unknown as HTMLSelectElement).selectedOptions[0]?.text ?? "") : !c.value;
      if (empty) { const l = (c.getAttribute("aria-label") || labelNear(c) || c.name || "a required field").slice(0, 90); const line = `${l} (empty)`; if (!out.includes(line)) out.push(line); }
    }
    return out.slice(0, 5);
  }, scope).catch(() => [] as string[]);
}

/** True when the page offers the control that sends the application (so you can review and press it yourself). */
export async function finalStepVisible(page: Page, scope?: string): Promise<boolean> {
  const byRole = (scope ? page.locator(`${scope} >> visible=true`).first().getByRole("button", { name: SENDS_APPLICATION }) : page.getByRole("button", { name: SENDS_APPLICATION })).first();
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


/** LinkedIn builds its job page after the first load: wait (briefly) for the apply button to appear before looking for it. */
export async function waitForLinkedinApply(page: Page, timeoutMs = 9000): Promise<void> {
  await page.locator('button[aria-label*="pply" i], a[aria-label*="pply" i], .jobs-apply-button, button:has-text("Apply"), a:has-text("Apply")').first().waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
}

/** LinkedIn asks "Job search safety reminders" before it sends you to a company's site: continue past it (its button is a button or a link). Returns true when it was there. */
export async function passSafetyReminder(page: Page): Promise<boolean> {
  const name = /^\s*continue applying\s*$/i;
  const btn = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
  if (await btn.isVisible({ timeout: 2500 }).catch(() => false)) { await btn.click({ timeout: 4000 }).catch(() => undefined); return true; }
  return false;
}

/** The Easy Apply window on a LinkedIn job page. Fields are read from inside it only. */
export const EASY_APPLY_SCOPE = '[role="dialog"], dialog[open], [aria-modal="true"], .artdeco-modal, .jobs-easy-apply-modal, [data-test-modal]';

/** Visible form controls that are not part of the site's header, navigation or search boxes. */
async function controlsOutsideNav(page: Page): Promise<number> {
  return page.locator(FIELD).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest("header, nav, [role=search], form[role=search], #global-nav, .global-nav, .search-global-typeahead")).length).catch(() => 0);
}

/**
 * After Easy Apply is pressed: wait for the application window (any dialog-like container) and say how it was found. Newer LinkedIn pages may
 * instead move to an /apply address and show the steps in the main area, so that counts too. Returns the scope to read fields from, or why not.
 */
async function waitForEasyApplyWindow(page: Page, timeoutMs = 9000): Promise<{ scope: string | null; why: string }> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.locator(`${EASY_APPLY_SCOPE} >> visible=true`).first().isVisible().catch(() => false)) return { scope: EASY_APPLY_SCOPE, why: "a window opened" };
    if (/\/apply\b/i.test(page.url()) && (await controlsOutsideNav(page)) >= 1) return { scope: "main", why: "the page moved to its /apply steps" };
    await page.waitForTimeout(400).catch(() => undefined);
  }
  const count = async (sel: string) => page.locator(sel).count().catch(() => 0);
  const why = `no application window found (address ${page.url().replace(/[?#].*$/, "")}${page.url().match(/currentJobId=\d+/)?.[0] ? ` showing ${page.url().match(/currentJobId=\d+/)![0]}` : ""}; role=dialog ${await count('[role="dialog"]')}, native dialog ${await count("dialog")}, aria-modal ${await count('[aria-modal="true"]')}, form fields outside the header ${await controlsOutsideNav(page)})`;
  return { scope: null, why };
}

export type LinkedinOpen = { kind: "easy" | "external" | "none"; page: Page; note: string; /** where Easy Apply's fields are read from */ scope?: string };
const clickHard = async (el: ReturnType<Page["locator"]>) => {
  try { await el.click({ timeout: 5000 }); return; } catch { /* covered or animating */ }
  try { await el.click({ timeout: 3000, force: true }); return; } catch { /* last resort */ }
  await el.evaluate((n) => (n as HTMLElement).click()).catch(() => undefined);
};
/** Words of whatever dialog is open on the page, for the hand-back message (a heading and short button names, never page text beyond that). */
async function dialogWords(page: Page): Promise<string> {
  const d = page.locator('[role="dialog"]').first();
  if (!(await d.isVisible().catch(() => false))) return "no dialog open";
  const heading = ((await d.locator("h1, h2, h3").first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const names = await d.locator("button, a").evaluateAll((els) => els.map((e) => ((e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").replace(/\s+/g, " ").trim())).filter((t) => t && t.length <= 40)).catch(() => [] as string[]);
  return `dialog "${heading}" with ${[...new Set(names)].slice(0, 5).join(" | ") || "no buttons"}`;
}

/**
 * Open a LinkedIn application on its own terms, and say what happened. Easy Apply opens a window on the page; "Apply on company website"
 * opens the company's page in a new tab, sometimes after a "safety reminders" window. Never presses the button that sends an application.
 */
export async function linkedinOpenApply(context: BrowserContext, page: Page, jobUrl?: string | null): Promise<LinkedinOpen> {
  const jobId = jobIdOf(jobUrl);
  const easy = await ownApplyControl(page, /^\s*easy apply/i, jobId) ?? await ownApplyControl(page, /easy apply/i, jobId);
  const EXTERNAL = /apply on company website|apply externally|apply on (the )?employer|^\s*apply\s*$/i;
  const external = easy ? null : await ownApplyControl(page, EXTERNAL, jobId);
  if (easy) {
    const urlBefore = page.url();
    await clickHard(easy.el);
    const w = await waitForEasyApplyWindow(page);
    if (w.scope) return { kind: "easy", page, note: `opened Easy Apply (${w.why})`, scope: w.scope };
    return { kind: "none", page, note: `clicked "${easy.name}"${easy.href ? ` (link to ${easy.href.slice(0, 80)})` : ""} on ${pathOf(urlBefore)} but ${w.why}` };
  }
  if (external) {
    const label = external.name.slice(0, 40) || "Apply";
    const popup = context.waitForEvent("page", { timeout: 12_000 }).catch(() => null);
    const before = page.url();
    await clickHard(external.el);
    await passSafetyReminder(page);
    const opened = await popup;
    if (opened) { await opened.waitForLoadState("domcontentloaded").catch(() => undefined); return { kind: "external", page: opened, note: `clicked "${label}", the company page opened in a new tab` }; }
    if (page.url() !== before && !/linkedin\.com/i.test(page.url())) return { kind: "external", page, note: `clicked "${label}", the page moved to the company site` };
    return { kind: "none", page, note: `clicked "${label}" but no new page opened (${await dialogWords(page)})` };
  }
  return { kind: "none", page, note: "no Easy Apply or company-website button was visible" };
}

const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u.slice(0, 60); } };
/** The number in a LinkedIn job link, or null. */
export const jobIdOf = (u: string | null | undefined): string | null => (u ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ?? (u ?? "").match(/currentJobId=(\d{6,})/)?.[1] ?? null;

/**
 * The apply control of THIS job. A LinkedIn page also lists other jobs, whose cards carry "Easy Apply" in their names and open that job when pressed,
 * so a control is skipped when it sits inside a list of jobs or links to a different job. Returns null when there is none.
 */
async function ownApplyControl(page: Page, name: RegExp, jobId: string | null): Promise<{ el: Locator; name: string; href: string } | null> {
  for (const c of [page.getByRole("button", { name }), page.getByRole("link", { name })]) {
    const n = Math.min(await c.count().catch(() => 0), 12);
    for (let i = 0; i < n; i++) {
      const el = c.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const info = await el.evaluate((e) => ({
        href: (e as HTMLAnchorElement).href ?? e.closest("a")?.getAttribute("href") ?? "",
        inList: !!e.closest("li, [role=listitem], [data-occludable-job-id], [data-job-id], .jobs-search-results-list, .scaffold-layout__list"),
        name: (e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").replace(/\s+/g, " ").trim(),
      })).catch(() => null);
      if (!info || info.inList) continue;
      const other = info.href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ?? info.href.match(/currentJobId=(\d{6,})/)?.[1];
      if (jobId && other && other !== jobId) continue;
      if (/\/jobs\/(search|collections)/.test(info.href) && !/openSDUIApplyFlow|\/apply/.test(info.href)) continue;
      return { el, name: info.name, href: info.href };
    }
  }
  return null;
}

export type LinkedinState = { applied: string | null; closed: boolean };
/** What the page's own words say: "Applied 2 weeks ago" (you already did), or that the role no longer takes applications. Pure. */
export function parseLinkedinState(bodyText: string): LinkedinState {
  const applied = bodyText.match(/\bApplied\s+(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|on\s+[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/);
  const closed = /no longer accepting applications|this job is no longer available|job (is )?closed|position has been filled/i.test(bodyText);
  return { applied: applied ? applied[0].replace(/\s+/g, " ") : null, closed };
}

/** The apply-related buttons and links a page shows, by name: what to tell you when the assistant could not find the form. Never page text beyond a few short labels. */
export async function applyButtonsSeen(page: Page): Promise<string[]> {
  const names = await page.locator("button, a, [role=button]").evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => ((e.getAttribute("aria-label") || (e as HTMLElement).innerText || "").replace(/\s+/g, " ").trim()))
    .filter((t) => t.length > 0 && t.length <= 48 && /apply|easy|sign in|join|continue|save/i.test(t))).catch(() => [] as string[]);
  return [...new Set(names)].slice(0, 8);
}


/** LinkedIn's signed-out view: a sign-in link and nothing that only a member's page has. */
export async function linkedinSignedOutView(page: Page): Promise<boolean> {
  const signInLink = (await page.locator('a[href*="/login"], a[href*="/signup"], button:has-text("Sign in")').count().catch(() => 0)) > 0;
  // LinkedIn's class names change, but a member's page always links to the member-only areas
  const memberLinks = (await page.locator('a[href*="/mynetwork"], a[href*="/messaging"], a[href*="/notifications"], #global-nav, nav.global-nav, .global-nav').count().catch(() => 0)) > 0;
  return signInLink && !memberLinks;
}

/** What the page offers, as short labels: the buttons a person could press. Used to say where a form stalled. */
export async function buttonsShown(page: Page, scope?: string): Promise<string[]> {
  const root = scope ? page.locator(`${scope} >> visible=true`).first() : page.locator("body");
  const names = await root.locator("button, [role=button], input[type=submit]").evaluateAll((els) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => ((e.getAttribute("aria-label") || (e as HTMLInputElement).value || (e as HTMLElement).innerText || "").replace(/\s+/g, " ").trim()))
    .filter((t) => t.length > 0 && t.length <= 40)).catch(() => [] as string[]);
  return [...new Set(names)].slice(0, 8);
}

/**
 * Is the browser's LinkedIn sign-in still accepted? A signed-out visitor sent to the home feed lands on a sign-in or join page; a member stays on the feed.
 * Opens its own tab and closes it. Returns null when it could not tell (no network, slow page): the caller then does not pause LinkedIn.
 */
export async function linkedinSessionAlive(context: BrowserContext): Promise<boolean | null> {
  const page = await context.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1500);
    return !/linkedin\.com\/(login|authwall|uas\/|signup|checkpoint)/i.test(page.url());
  } catch { return null; } finally { await page.close().catch(() => undefined); }
}

/**
 * Cancel every download any tab of this browser starts, and say which file it was. The assistant takes no files from a page and installs nothing:
 * a page that offers a program or an archive is a trap, and the application it belonged to is handed back instead.
 */
export function guardDownloads(context: BrowserContext, onBlocked: (name: string) => void): void {
  const watch = (p: Page) => p.on("download", (d) => { onBlocked(d.suggestedFilename() || "a file"); void d.cancel().catch(() => undefined); });
  context.pages().forEach(watch);
  context.on("page", watch);
}

/**
 * Is the browser still on the job we meant to apply for? LinkedIn sends a removed or closed job to its search results, where an "Easy Apply" button
 * belongs to some other job: pressing it would apply to the wrong one. True on the job's own page, or on a results page that shows this job (currentJobId).
 */
export function onJobPage(currentUrl: string, jobUrl: string | null | undefined): boolean {
  const id = (jobUrl ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ?? (jobUrl ?? "").match(/currentJobId=(\d{6,})/)?.[1];
  if (!id) return true; // not a LinkedIn job link we can read: nothing to compare
  return new RegExp(`/jobs/view/(?:[^/?#]*-)?${id}(?:[/?#]|$)|currentJobId=${id}(?:&|$)`).test(currentUrl);
}

/** Employer systems that make you create or sign in to an account for each company: the assistant does not create accounts, so these are handed back with that reason. */
export function accountGatedVendor(host: string): string | null {
  const h = host.toLowerCase();
  if (/myworkdayjobs\.com$|\.workday\.com$/.test(h)) return "Workday";
  if (/(^|\.)icims\.com$/.test(h)) return "iCIMS";
  if (/(^|\.)taleo\.net$/.test(h)) return "Taleo";
  if (/successfactors\.(com|eu)$/.test(h)) return "SAP SuccessFactors";
  if (/(^|\.)oraclecloud\.com$/.test(h)) return "Oracle Recruiting";
  return null;
}


/**
 * The structure of a page (its windows and controls: tags, roles, labels, names), never a typed value: what `npm run assist:probe` prints so the
 * assistant can be fixed against a real LinkedIn page. `scope` is the CSS selector of the window to describe, with the main area as the fallback.
 */
export async function describePage(page: Page, scope: string): Promise<unknown> {
  return page.evaluate((scopeSel) => {
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const short = (t: string | null | undefined, n = 60) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
      const cls = (e: Element) => short(typeof (e as HTMLElement).className === "string" ? (e as HTMLElement).className : "", 80).split(" ").slice(0, 4).join(" ");
      const labelOf = (e: HTMLInputElement) => short(e.getAttribute("aria-label") || (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : "") || e.closest("label")?.textContent || e.getAttribute("placeholder") || "");
      const outline = (e: Element) => { const i = e as HTMLInputElement; return { tag: e.tagName.toLowerCase(), role: e.getAttribute("role") ?? undefined, type: i.type || undefined, name: i.name || undefined, id: short(e.id, 40) || undefined, aria: short(e.getAttribute("aria-label")) || undefined, label: labelOf(i) || undefined, cls: cls(e) || undefined, required: i.required || undefined }; };
      const containers = [...document.querySelectorAll(`${scopeSel}, main, [aria-modal], [role=dialog]`)].filter(vis).slice(0, 8).map((c) => ({ ...outline(c), visibleControls: c.querySelectorAll("input, select, textarea, button, a[href]").length }));
      const scope = [...document.querySelectorAll(scopeSel)].find(vis) ?? document.querySelector("main") ?? document.body;
      const controls = [...scope.querySelectorAll("input, select, textarea, button, a[href], [role=button]")].filter(vis).slice(0, 80).map((e) => ({ ...outline(e), text: short(e.textContent, 40) }));
      return { url: location.href.replace(/[?#].*$/, ""), title: short(document.title, 80), containers, controls };
  }, scope) as Promise<unknown>;
}


/**
 * Step through an Easy Apply window with Next/Continue/Review and describe every page (structure only), stopping BEFORE the button that sends
 * the application, which is never pressed. For `npm run assist:probe`: it shows what each step of a real application asks.
 */
export async function walkEasyApply(page: Page, scope: string, maxPages = 6): Promise<{ pages: unknown[]; stoppedAt: string }> {
  const pages: unknown[] = [];
  let last = "";
  for (let i = 0; i < maxPages; i++) {
    await page.waitForTimeout(1800).catch(() => undefined);
    const d = await describePage(page, scope);
    const sig = JSON.stringify(d);
    if (sig === last) {
      const refused = await refusedFields(page, scope).catch(() => [] as string[]);
      return { pages, stoppedAt: `a question needs an answer before LinkedIn lets the form go on${refused.length ? ` (${refused.join("; ")})` : ""}; the probe fills nothing, the assistant answers these from your profile and answer bank` };
    }
    last = sig;
    pages.push(d);
    const root = page.locator(`${scope} >> visible=true`).first();
    if (await root.getByRole("button", { name: /submit( application)?|send application/i }).first().isVisible().catch(() => false)) return { pages, stoppedAt: "the Submit button, which was not pressed" };
    const next = root.getByRole("button", { name: NEXT_STEP }).first();
    if (!(await next.isVisible().catch(() => false))) return { pages, stoppedAt: "no Next button on this page" };
    await next.click({ timeout: 5000 }).catch(() => undefined);
  }
  return { pages, stoppedAt: `${maxPages} pages` };
}
