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
//
// LinkedIn has changed its job search page more than once (the address is now /jobs/search-results/ and its class names are generated), so nothing here depends on a
// class name. A job is found by the link to it (/jobs/view/<number> or ?currentJobId=<number>), a card is the largest block around that link that holds no other job's
// link, and the apply control is found by what it says. The left half of the page is the list, the right half the selected job.
// ---------------------------------------------------------------------------------------------------------------------------
export type LinkedinCard = { id: string; title: string; company: string; easy: boolean; applied: boolean };
export type LinkedinDetail = { id: string | null; title: string; company: string; location: string; url: string; easy: boolean; external: boolean; applied: string | null; closed: boolean };

const LI_ID = /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})|currentJobId=(\d{6,})/;
const idOfHref = (h: string | null | undefined): string | null => { const m = (h ?? "").match(LI_ID); return m ? (m[1] ?? m[2]) : null; };
const LI_APPLIED = /\bApplied\s+(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|on\s+[A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/;
const LI_CLOSED = /no longer accepting applications|this job is no longer available|job (is )?closed|position has been filled/i;
const lines = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).filter((l, i, a) => l !== a[i - 1]);
const centreX = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.left + r.width / 2; };

type ListItem = { id: string; el: HTMLElement; link: HTMLElement };
/** Every job in the list on the left: its number, its card, and the link that opens it. */
function listItems(): ListItem[] {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) => visible(a) && idOfHref(a.getAttribute("href")) && !a.closest("header, nav, [role=search]") && centreX(a) < window.innerWidth * 0.6);
  const ids = (el: Element) => new Set([...el.querySelectorAll("a[href]")].map((a) => idOfHref(a.getAttribute("href"))).filter(Boolean));
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const a of links) {
    const id = idOfHref(a.getAttribute("href"))!;
    if (seen.has(id)) continue;
    seen.add(id);
    let card: HTMLElement = a;
    while (card.parentElement && card.parentElement !== document.body && ids(card.parentElement).size === 1) card = card.parentElement;
    out.push({ id, el: card, link: a });
  }
  return out;
}

function linkedinCards(): LinkedinCard[] {
  return listItems().map(({ id, el, link }) => {
    const ls = lines(el);
    const title = once(text(link)) || ls[0] || "";
    const at = ls.findIndex((l) => l === title || title.startsWith(l) || l.startsWith(title));
    return {
      id, title,
      company: once(ls[(at >= 0 ? at : 0) + 1] ?? ""),
      easy: /\bEasy Apply\b/i.test(ls.join(" ")),
      applied: ls.some((l) => /^Applied(\s|$)/i.test(l)),
    };
  });
}

function scrollableOf(el: Element | null | undefined): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 4) return p; }
  return null;
}
/** Load the rest of the list (LinkedIn draws the cards only as the list is scrolled). */
function linkedinScrollList(): number {
  const first = listItems()[0];
  const box = scrollableOf(first?.el) ?? (document.scrollingElement as HTMLElement | null);
  if (box) box.scrollTop = box.scrollHeight;
  return listItems().length;
}

function linkedinSelect(id: string): boolean {
  const item = listItems().find((i) => i.id === id);
  if (!item) return false;
  click(item.link);
  return true;
}

/** The filter bar above the list ("Date posted", "Company", "Remote", ...): its buttons, which include an "Easy Apply" filter, are never the job's apply button. */
const FILTER_WORDS = /^(date posted|experience level|company|remote|job type|on-site|hybrid|salary|location|industry|all filters|reset|show results|under \d+ applicants|verified|easy apply)$/i;
/** A button is in the filter bar when it sits with other filter buttons in a block that holds no job card and no heading (the block around the apply button also holds the job's title). */
function inFilterBar(b: HTMLElement): boolean {
  const cards = listItems().map((i) => i.el);
  let near = 0;
  for (const other of buttons(document)) {
    if (other === b || !FILTER_WORDS.test(nameOf(other))) continue;
    let p: HTMLElement | null = b.parentElement;
    while (p && !p.contains(other)) p = p.parentElement;
    if (p && !cards.some((c) => p!.contains(c)) && !p.querySelector("h1, h2")) near++;
  }
  return near >= 2;
}

/** The apply controls of the job that is open: not inside a card, not in the filter bar, not a switch that says whether it is on. */
function detailControls(): HTMLElement[] {
  const cards = listItems().map((i) => i.el);
  return buttons(document).filter((b) => !cards.some((c) => c.contains(b)) && !b.closest("header, nav, [role=search]") && !b.hasAttribute("aria-pressed") && !b.hasAttribute("aria-checked") && !b.hasAttribute("aria-expanded") && !inFilterBar(b))
    .sort((x, y) => centreX(y) - centreX(x)); // the job is on the right when the page has two sides
}

function linkedinDetail(): LinkedinDetail {
  const id = (location.search.match(/currentJobId=(\d{6,})/) ?? location.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/))?.[1] ?? null;
  const ctrls = detailControls();
  const easy = ctrls.find((b) => /easy apply/i.test(nameOf(b)));
  const external = !easy && ctrls.some((b) => /apply on company website|apply externally|^\s*apply\s*$/i.test(nameOf(b)));
  const right = [...document.querySelectorAll<HTMLElement>("main a[href*='/company/'], a[href*='/company/']")].find((a) => visible(a) && centreX(a) >= window.innerWidth * 0.4 && !a.closest("header, nav"));
  const heading = [...document.querySelectorAll<HTMLElement>("h1, h2")].find((h) => visible(h) && centreX(h) >= window.innerWidth * 0.4 && text(h).length > 3);
  const body = document.body?.innerText ?? "";
  const applied = body.match(LI_APPLIED);
  return {
    id, title: once(text(heading)), company: once(text(right)), location: "", url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href,
    easy: !!easy, external, applied: applied ? applied[0].replace(/\s+/g, " ") : null, closed: LI_CLOSED.test(body),
  };
}

function linkedinPressEasyApply(): string | null {
  const btn = detailControls().find((b) => /easy apply/i.test(nameOf(b)));
  if (!btn) return null;
  click(btn);
  return nameOf(btn).slice(0, 40);
}

/** Where the application is: in a window over the page, or on a page of its own (an /apply address). */
function linkedinWindow(): "dialog" | "page" | null {
  if (openDialog()) return "dialog";
  if (/\/apply\b/i.test(location.pathname + location.search) && document.querySelector("main input:not([type=hidden]), main select, main textarea, main button")) return "page";
  return null;
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

/** The "Application sent" message, in the window or on the page. */
function linkedinSent(): string | null {
  const t = text(openDialog() ?? document.querySelector("main"));
  const m = t.match(/your application was sent( to [^.]{1,60})?/i) ?? t.match(/application sent/i);
  return m ? m[0] : null;
}

/** Close the window after a sent application ("Done"), or abandon one that could not be finished (X, then Discard). */
function linkedinClose(discard: boolean): string {
  const d = openDialog();
  if (!d) return "none";
  const named = (re: RegExp) => buttons(d).find((b) => re.test(nameOf(b)));
  if (!discard) { const done = named(/^(done|dismiss)$/i); if (done) { click(done); return "done"; } }
  const x = d.querySelector<HTMLElement>('button[aria-label="Dismiss"], button[aria-label*="ismiss" i], button.artdeco-modal__dismiss, button[aria-label*="lose" i]');
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
  if (openDialog()) return false;
  const all = [...document.querySelectorAll<HTMLElement>("button, a")].filter(visible);
  const next = all.find((e) => /^(view )?next( page)?$/i.test(nameOf(e)) && !(e as HTMLButtonElement).disabled && e.getAttribute("aria-disabled") !== "true" && !e.closest("header"));
  if (!next) return false;
  click(next);
  return true;
}

/** What the page shows, as plain facts: used to say what was there when something was not found, and by "Diagnose this page". */
function linkedinFacts() {
  const items = listItems();
  const ctrls = buttons(document).filter((b) => /apply/i.test(nameOf(b))).slice(0, 8).map((b) => ({ tag: b.tagName.toLowerCase(), name: nameOf(b).slice(0, 40), pressed: b.getAttribute("aria-pressed"), href: ((b as HTMLAnchorElement).getAttribute?.("href") ?? "").replace(/[?#].*$/, "").slice(0, 60), x: Math.round(centreX(b)) }));
  const dialogs = [...document.querySelectorAll(DIALOG)].filter(visible).map((d) => ({ heading: text(d.querySelector("h1,h2,h3")).slice(0, 60), buttons: buttons(d).map(nameOf).filter((n) => n && n.length < 40).slice(0, 6) }));
  return {
    page: location.pathname, width: window.innerWidth, jobLinks: document.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']").length, listItems: items.length,
    firstJobs: linkedinCards().slice(0, 3), selectedJobInAddress: (location.search.match(/currentJobId=(\d{6,})/) ?? [])[1] ?? null,
    applyControlsOnPage: ctrls, applyControlUsed: detailControls().filter((b) => /easy apply/i.test(nameOf(b))).map(nameOf).slice(0, 2),
    windows: dialogs, applicationPage: linkedinWindow(), mainHasControls: !!document.querySelector("main input, main select, main textarea"),
  };
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

function naukriFacts() {
  return { page: location.pathname, cards: naukriCards().length, firstJobs: naukriCards().slice(0, 3).map(({ id, title, company }) => ({ id, title, company })), state: naukriState() };
}

export const site = {
  linkedin: { cards: linkedinCards, scrollList: linkedinScrollList, select: linkedinSelect, detail: linkedinDetail, pressEasyApply: linkedinPressEasyApply, windowOpen: linkedinWindow, blocker: linkedinBlocker, sent: linkedinSent, close: linkedinClose, discard: linkedinDiscard, nextPage: linkedinNextPage, facts: linkedinFacts },
  naukri: { cards: naukriCards, state: naukriState, pressApply: naukriPressApply, nextPage: naukriNextPage, facts: naukriFacts },
};

declare global { interface Window { __careerAgentSite?: typeof site } }
window.__careerAgentSite = site;
