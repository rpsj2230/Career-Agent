/**
 * Page-side helpers for "Filter Auto Apply": the list of jobs a person has filtered on LinkedIn or Naukri, one job's own page, its apply button, and the window that
 * opens. Plain reading of the page: it never types, never presses Submit (the shared automatic step does, with the same safety checks) and never leaves the page it is on.
 *
 * Built from how these sites are laid out and from the selectors the assistant on the Mac already uses; their pages change often, so every function answers "not found"
 * rather than guessing, and the caller then skips the job or hands it back with the reason.
 */
const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** LinkedIn writes a title twice (once visible, once for screen readers): "Head of Ops Head of Ops". Keep one. */
const once = (s: string) => { const t = s.trim(); const h = Math.floor(t.length / 2); return t.length > 4 && t.length % 2 === 1 && t.slice(0, h) === t.slice(h + 1) ? t.slice(0, h) : t.length > 4 && t.length % 2 === 0 && t.slice(0, h) === t.slice(h) ? t.slice(0, h) : t; };
const click = (el: Element) => { (el as HTMLElement).scrollIntoView?.({ block: "center" }); (el as HTMLElement).click(); };

const DIALOG = '[role="dialog"], dialog[open], [aria-modal="true"], .artdeco-modal, .jobs-easy-apply-modal';
const openDialog = (): Element | null => [...document.querySelectorAll(DIALOG)].find(visible) ?? null;
const buttons = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"], a')].filter(visible);
const nameOf = (el: Element) => ((el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------------------------------------------------------
export type LinkedinCard = { id: string; title: string; company: string; easy: boolean; applied: boolean };
export type LinkedinDetail = { id: string | null; title: string; company: string; location: string; url: string; easy: boolean; external: boolean; applied: string | null; closed: boolean };

const LI_CARD = 'li[data-occludable-job-id], div.job-card-container[data-job-id], li.scaffold-layout__list-item, li.jobs-search-results__list-item, div[data-job-id]';
const LI_APPLIED = /\bApplied\s+(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|on\s+[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/;
const LI_CLOSED = /no longer accepting applications|this job is no longer available|job (is )?closed|position has been filled/i;

const liId = (c: Element): string | null => {
  const raw = c.getAttribute("data-occludable-job-id") ?? c.getAttribute("data-job-id") ?? c.querySelector("[data-job-id]")?.getAttribute("data-job-id") ?? "";
  const m = raw.match(/(\d{6,})/) ?? (c.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null)?.href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/);
  return m ? m[1] : null;
};

function linkedinCards(): LinkedinCard[] {
  const seen = new Set<string>();
  const out: LinkedinCard[] = [];
  for (const c of document.querySelectorAll(LI_CARD)) {
    const id = liId(c);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const body = text(c);
    const footer = text(c.querySelector(".job-card-container__footer-job-state, .job-card-container__footer-wrapper, footer"));
    out.push({
      id,
      title: once(text(c.querySelector("a.job-card-list__title, .job-card-list__title, a.job-card-container__link, .artdeco-entity-lockup__title, a[href*='/jobs/view/']"))),
      company: once(text(c.querySelector(".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name"))),
      easy: /\bEasy Apply\b/i.test(body),
      applied: /(^|\s)Applied(\s|$)/.test(footer),
    });
  }
  return out;
}

/** Load the rest of the list (LinkedIn draws cards only as the list is scrolled). */
function linkedinScrollList(): number {
  const list = document.querySelector<HTMLElement>(".jobs-search-results-list, .scaffold-layout__list, .jobs-search-results__list") ?? document.scrollingElement as HTMLElement;
  if (list) list.scrollTop = list.scrollHeight;
  return document.querySelectorAll(LI_CARD).length;
}

function linkedinSelect(id: string): boolean {
  const card = [...document.querySelectorAll(LI_CARD)].find((c) => liId(c) === id);
  if (!card) return false;
  const link = card.querySelector<HTMLElement>("a.job-card-list__title, a.job-card-container__link, a[href*='/jobs/view/']");
  click(link ?? card);
  return true;
}

function linkedinDetail(): LinkedinDetail {
  const pane = document.querySelector(".jobs-search__job-details--container, .jobs-details, .job-view-layout, .scaffold-layout__detail") ?? document.querySelector("main") ?? document.body;
  const inList = (el: Element) => !!el.closest(LI_CARD) || !!el.closest(".jobs-search-results-list, .scaffold-layout__list");
  const apply = buttons(pane).filter((b) => !inList(b));
  const easy = apply.find((b) => /^\s*easy apply/i.test(nameOf(b)) || /easy apply/i.test(nameOf(b)));
  const external = !easy && apply.some((b) => /apply on company website|apply externally|^\s*apply\s*$/i.test(nameOf(b)));
  const href = (apply.find((b) => (b as HTMLAnchorElement).href)?.getAttribute("href") ?? "");
  const id = (location.search.match(/currentJobId=(\d{6,})/) ?? location.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/) ?? href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/))?.[1] ?? pane.querySelector("[data-job-id]")?.getAttribute("data-job-id")?.match(/(\d{6,})/)?.[1] ?? null;
  const top = pane.querySelector(".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__primary-description, .jobs-unified-top-card__subtitle-primary-grouping");
  const body = text(pane);
  const applied = body.match(LI_APPLIED);
  return {
    id,
    title: once(text(pane.querySelector(".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1, h2.t-24"))),
    company: once(text(pane.querySelector(".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name"))),
    location: text(top).split("·").map((s) => s.trim()).find((s, i) => i === 1 || (i === 0 && !/^\d/.test(s))) ?? "",
    url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href,
    easy: !!easy, external, applied: applied ? applied[0].replace(/\s+/g, " ") : null, closed: LI_CLOSED.test(body),
  };
}

function linkedinPressEasyApply(): string | null {
  const pane = document.querySelector(".jobs-search__job-details--container, .jobs-details, .job-view-layout, .scaffold-layout__detail") ?? document.querySelector("main") ?? document.body;
  const btn = buttons(pane).filter((b) => !b.closest(LI_CARD) && !b.closest(".jobs-search-results-list, .scaffold-layout__list")).find((b) => /easy apply/i.test(nameOf(b)));
  if (!btn) return null;
  click(btn);
  return nameOf(btn).slice(0, 40);
}

/** What stops a whole run, whatever the job: LinkedIn asking for a security check, or saying the day's Easy Apply limit is reached. */
function linkedinBlocker(): string | null {
  if (/^\/(checkpoint|uas\/login|authwall)/.test(location.pathname)) return "LinkedIn is asking you to sign in or to complete a security check";
  const t = (document.body?.innerText ?? "").slice(0, 30000);
  const m = t.match(/(let'?s do a quick security check|unusual activity|verify (that )?you'?re (a )?human|security verification)/i);
  if (m) return `LinkedIn is asking for a security check ("${m[0]}")`;
  const lim = t.match(/(reached|exceeded) (the |your )?(daily |today'?s )?(easy apply )?(application )?limit|easy apply (application )?limit/i);
  if (lim) return `LinkedIn says the Easy Apply limit is reached ("${lim[0]}")`;
  return null;
}

/** The "Application sent" message in the window after Submit. */
function linkedinSent(): string | null {
  const d = openDialog();
  const t = text(d);
  const m = t.match(/your application was sent( to [^.]{1,60})?/i) ?? t.match(/application sent/i);
  return m ? m[0] : null;
}

/** Close the window after a sent application ("Done"), or abandon one that could not be finished (X, then Discard). */
function linkedinClose(discard: boolean): string {
  const d = openDialog();
  if (!d) return "none";
  const named = (re: RegExp) => buttons(d).find((b) => re.test(nameOf(b)));
  if (!discard) { const done = named(/^(done|dismiss)$/i); if (done) { click(done); return "done"; } }
  const x = d.querySelector<HTMLElement>('button[aria-label="Dismiss"], button[aria-label*="ismiss" i], button.artdeco-modal__dismiss');
  if (x) { click(x); return "dismissed"; }
  return "no close button";
}
/** After X, LinkedIn asks whether to save the half-filled application: say no (Discard). */
function linkedinDiscard(): boolean {
  // the question opens as a second window on top of the application window: look in every open window, the topmost first
  for (const d of [...document.querySelectorAll(DIALOG)].filter(visible).reverse()) {
    const b = buttons(d).find((x) => /^discard$/i.test(nameOf(x)));
    if (b) { click(b); return true; }
  }
  return false;
}

function linkedinNextPage(): boolean {
  const next = document.querySelector<HTMLElement>('button[aria-label="View next page"], button.jobs-search-pagination__button--next, li.artdeco-pagination__indicator--number.active + li button');
  if (!next || (next as HTMLButtonElement).disabled || !visible(next)) return false;
  click(next);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Naukri
// ---------------------------------------------------------------------------------------------------------------------------
export type NaukriCard = { id: string; title: string; company: string; url: string };
export type NaukriState = { applied: string | null; closed: boolean; loginWall: boolean; apply: string | null; external: boolean; success: boolean; questions: boolean; /** the buttons the page shows, to say what was there when no Apply button was found */ seen: string[]; url: string };

const NK_CARD = ".srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple, div[class*='jobTuple']";
const NK_SUCCESS = /successfully\s+applied|you\s+have\s+successfully\s+applied|application\s+(has\s+been\s+)?(sent|submitted)/i;
const NK_APPLIED = /(you\s+have\s+already\s+applied[^.\n]{0,60}|already\s+applied\s+(for|to)\s+this\s+job|you['’]ve\s+(already\s+)?applied[^.\n]{0,40})/i;
const NK_CLOSED = /this\s+job\s+(is\s+)?(no\s+longer|not)\s+(accepting|available)|job\s+(has\s+)?expired|(position|vacancy)\s+(has\s+been\s+|is\s+)?closed|no\s+longer\s+accepting\s+applications/i;
const NK_LOGIN = /(login|log\s*in|sign\s*in|register)\s+(or\s+register\s+)?to\s+apply|login\s+to\s+continue|please\s+login/i;
/** Naukri's follow-up questions open in a side panel or dialog */
export const NAUKRI_QUESTIONS = '[class*="chatbot" i], [class*="drawer" i], [role="dialog"], [aria-modal="true"]';

function naukriCards(): NaukriCard[] {
  const out: NaukriCard[] = [];
  const seen = new Set<string>();
  for (const c of document.querySelectorAll(NK_CARD)) {
    const a = c.querySelector<HTMLAnchorElement>("a.title, a[class*='title'], a[href*='job-listings']");
    const url = a?.href ?? "";
    const id = c.getAttribute("data-job-id") ?? url.match(/-(\d{6,})(?:[?#]|$)/)?.[1] ?? "";
    if (!a || !url || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: text(a), company: text(c.querySelector("a.comp-name, .comp-name, [class*='comp-name']")), url });
  }
  return out;
}

function naukriState(): NaukriState {
  const body = document.body?.innerText ?? "";
  const skip = '[class*="similar" i], [class*="recommend" i]';
  const own = buttons(document).filter((b) => !b.closest(skip));
  const internal = own.find((b) => /^\s*apply(\s+now)?\s*$/i.test(nameOf(b)) || b.id === "apply-button");
  const external = !internal && own.some((b) => /apply\s+on\s+company\s+(site|website)|apply\s+on\s+employer|apply\s+externally/i.test(nameOf(b)) || b.id === "company-site-button");
  const applied = body.match(NK_APPLIED);
  const q = [...document.querySelectorAll(NAUKRI_QUESTIONS)].find(visible);
  return {
    applied: applied ? applied[0].replace(/\s+/g, " ").trim() : null, closed: NK_CLOSED.test(body), loginWall: NK_LOGIN.test(body) && !!document.querySelector('input[type="password"]'),
    seen: [...new Set(own.map(nameOf).filter((n) => n && n.length <= 40))].slice(0, 8), url: location.href.replace(/[?#].*$/, ""),
    apply: internal ? nameOf(internal) : null, external, success: NK_SUCCESS.test(body), questions: !!q && !!q.querySelector("input:not([type=hidden]), textarea, select, [role=radio]"),
  };
}

function naukriPressApply(): string | null {
  const skip = '[class*="similar" i], [class*="recommend" i]';
  const btn = buttons(document).filter((b) => !b.closest(skip)).find((b) => /^\s*apply(\s+now)?\s*$/i.test(nameOf(b)) || b.id === "apply-button");
  if (!btn) return null;
  click(btn);
  return nameOf(btn).slice(0, 40);
}

function naukriNextPage(): boolean {
  const next = [...document.querySelectorAll<HTMLElement>("a, button")].find((e) => visible(e) && /^\s*next\s*$/i.test(nameOf(e)) && !(e as HTMLButtonElement).disabled && !e.classList.contains("disabled"));
  if (!next) return false;
  click(next);
  return true;
}

export const site = {
  linkedin: { cards: linkedinCards, scrollList: linkedinScrollList, select: linkedinSelect, detail: linkedinDetail, pressEasyApply: linkedinPressEasyApply, windowOpen: () => !!openDialog(), blocker: linkedinBlocker, sent: linkedinSent, close: linkedinClose, discard: linkedinDiscard, nextPage: linkedinNextPage },
  naukri: { cards: naukriCards, state: naukriState, pressApply: naukriPressApply, nextPage: naukriNextPage },
};

declare global { interface Window { __careerAgentSite?: typeof site } }
window.__careerAgentSite = site;
