import { CONFIRMATION, matchAnswer, standardValue, type Answer } from "../../worker/match";
import { languageAnswer } from "../../src/lib/apply/languages";
import { CONSENT_BOX } from "../../src/lib/apply/consent";
import { destinationTrust, sensitiveKind } from "../../src/lib/apply/safety";
import { confirmationSnippet } from "../../src/lib/apply/submission";
import { declineOption } from "../../src/lib/apply/demographics";
import { asCount, defaultToolYears, skillYears, wantsNumber, yearsSkill } from "../../src/lib/apply/skill-years";
import type { FillData } from "../../src/lib/apply/fill-data";
import type { MasterProfile } from "../../src/lib/types";

/**
 * Fills the form on the page you are looking at, from your own data, and stops. It never presses a button, never submits, never types a password, a payment or an identity number,
 * and leaves a field alone when it already has something in it. What it could not answer is outlined in orange and listed for you.
 */
export type FillReport = { filled: string[]; forYou: string[]; secret: string[] };

const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clean = (s: string) => s.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();

function labelOf(el: HTMLInputElement): string {
  const al = el.getAttribute("aria-label"); if (al) return al;
  const by = el.getAttribute("aria-labelledby");
  if (by) { const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim(); if (t) return t; }
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return text(l); }
  const wrap = el.closest("label"); if (wrap) return text(wrap);
  return el.getAttribute("placeholder") || el.name || "";
}
function groupLabelOf(el: HTMLInputElement): string {
  const fs = el.closest("fieldset"); const legend = fs?.querySelector("legend"); if (legend) return text(legend);
  const grp = el.closest("[role=radiogroup],[role=group]");
  if (grp?.getAttribute("aria-label")) return grp.getAttribute("aria-label")!;
  const gby = grp?.getAttribute("aria-labelledby");
  if (gby) { const t = gby.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim(); if (t) return t; }
  return text(el.closest("div")?.parentElement?.querySelector("label,legend,p,span") ?? null);
}

/** Set a value the way a person typing would, so frameworks that watch the field (React, Angular) notice it. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
function pick(options: string[], answer: string): number {
  const a = norm(answer); const yn = /^\s*(yes|y|true)\b/i.test(answer) ? "yes" : /^\s*(no|n|false)\b/i.test(answer) ? "no" : null;
  let i = options.findIndex((o) => norm(o) === a);
  if (i < 0 && yn) i = options.findIndex((o) => norm(o).startsWith(yn));
  if (i < 0) i = options.findIndex((o) => norm(o).includes(a) || (norm(o).length > 2 && a.includes(norm(o))));
  return i;
}
const flag = (el: Element) => { (el as HTMLElement).style.outline = "2px solid #f97316"; (el as HTMLElement).style.outlineOffset = "2px"; };

export function fillPage(data: FillData): FillReport {
  const out: FillReport = { filled: [], forYou: [], secret: [] };
  const profile = { experience: data.experience.map((e, i) => ({ id: `e${i}`, company: "", title: e.title, start: e.start, end: e.end, bullets: e.bullets.map((t, j) => ({ id: `b${i}.${j}`, text: t })) })) } as unknown as MasterProfile;
  const answers: Answer[] = data.answers;
  // inside a window (a dialog) only its own fields count; otherwise the whole page
  const dialog = [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].find(visible);
  const root: ParentNode = dialog ?? document;
  const controls = [...root.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((e) => {
    const t = (e.type || "").toLowerCase();
    return !["hidden", "submit", "button", "image", "reset", "file"].includes(t) && !e.disabled && !e.readOnly && visible(e) && !e.closest("header, nav, [role=search]");
  });
  const done = new Set<string>();
  const valueFor = (label: string, options: string[]): string | null => {
    const std = standardValue(label, data.applicant);
    if (std) return std;
    const banked = matchAnswer(label, answers);
    if (banked) return banked;
    const skill = yearsSkill(label);
    if (skill) return skillYears(profile, skill) ?? defaultToolYears(profile, skill);
    return languageAnswer(label, options, data.languages) ?? declineOption(label, options);
  };
  for (const el of controls) {
    const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();
    const required = el.required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(labelOf(el));
    if (type === "radio") {
      const group = el.name || labelOf(el); if (done.has(group)) continue; done.add(group);
      const members = [...root.querySelectorAll<HTMLInputElement>(`input[type=radio]${el.name ? `[name="${CSS.escape(el.name)}"]` : ""}`)].filter(visible);
      if (members.some((m) => m.checked)) continue;
      const label = clean(groupLabelOf(el)); const opts = members.map((m) => clean(labelOf(m)));
      const v = label ? valueFor(label, opts) : null; const i = v ? pick(opts, v) : -1;
      if (i >= 0) { members[i].click(); out.filled.push(label); } else if (required && label) { out.forYou.push(label); members.forEach(flag); }
      continue;
    }
    if (type === "checkbox") {
      const label = clean(labelOf(el));
      if (required && !el.checked && CONSENT_BOX.test(label)) { el.click(); out.filled.push(label); }
      else if (required && !el.checked && label) { out.forYou.push(`${label} (a box that is not a plain agreement)`); flag(el); }
      continue;
    }
    const label = clean(labelOf(el) || groupLabelOf(el));
    if (!label) continue;
    const secret = sensitiveKind(label, type);
    if (secret) { out.secret.push(label); flag(el); continue; }
    if (type === "select" ? !!(el as unknown as HTMLSelectElement).value && !/^\s*(select|choose)/i.test((el as unknown as HTMLSelectElement).selectedOptions[0]?.text ?? "") : !!el.value) continue;
    const options = type === "select" ? [...(el as unknown as HTMLSelectElement).options].map((o) => o.text.trim()).filter((t) => t && !/^\s*(please\s+)?(select|choose)\b/i.test(t)) : [];
    let v = valueFor(label, options);
    if (v != null && type !== "select" && wantsNumber(label)) v = asCount(v);
    if (v == null) { if (required) { out.forYou.push(label); flag(el); } continue; }
    if (type === "select") {
      const sel = el as unknown as HTMLSelectElement; const i = pick([...sel.options].map((o) => o.text.trim()), v);
      if (i >= 0) { setValue(sel, sel.options[i].value); out.filled.push(label); } else if (required) { out.forYou.push(label); flag(el); }
    } else { setValue(el, v); out.filled.push(label); }
  }
  return out;
}

export type FileSpec = { name: string; type: string; b64: string };
export type AttachReport = { attached: string[]; missing: string[] };

/** What says what a file box is for: its label, name and id, and else the text around it (never the text of a container that also holds another file box). */
const KIND_WORDS = (el: HTMLInputElement): string => {
  const own = [labelOf(el), el.name, el.id, el.getAttribute("accept") ?? ""].join(" ").toLowerCase();
  if (/resume|\bcv\b|curriculum|cover/.test(own)) return own;
  let box: Element | null = el.parentElement, near = "";
  for (let i = 0; i < 4 && box && box.querySelectorAll('input[type="file"]').length === 1; i++, box = box.parentElement) { const t = text(box); if (t.length > 0 && t.length <= 240) { near = t; break; } }
  return `${own} ${near}`.toLowerCase();
};

function toFile(f: FileSpec): File {
  const bin = atob(f.b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.type });
}

/**
 * Puts the resume (and cover letter) prepared for this application into the file boxes of the page. A box counts as the resume when its label, name or
 * nearby text says resume / CV, as the cover letter when it says cover; a page with a single file box and no other clue gets the resume. A box that already holds a file is left alone.
 */
export function attachFiles(resume: FileSpec | null, cover: FileSpec | null): AttachReport {
  const out: AttachReport = { attached: [], missing: [] };
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter((e) => !e.disabled);
  const give = (el: HTMLInputElement, f: FileSpec) => {
    const dt = new DataTransfer(); dt.items.add(toFile(f));
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    out.attached.push(f.name);
  };
  const free = inputs.filter((e) => !e.files?.length);
  const isCover = (e: HTMLInputElement) => /cover/.test(KIND_WORDS(e));
  const isResume = (e: HTMLInputElement) => !isCover(e) && /resume|\bcv\b|curriculum/.test(KIND_WORDS(e));
  if (resume) {
    const target = free.find(isResume) ?? (inputs.length === 1 && free.length === 1 && !isCover(free[0]) ? free[0] : undefined);
    if (target) give(target, resume); else out.missing.push(inputs.length ? "no file box on this page asks for a resume" : "this page has no file box yet (if it has an Upload or Attach button, press it once, then fill again)");
  }
  if (cover) {
    const target = free.find((e) => isCover(e) && !e.files?.length);
    if (target) give(target, cover);
  }
  return out;
}


// ---------------------------------------------------------------------------------------------------------------------------
// Automatic mode: after the form is filled, decide whether this page is safe and complete, and press Next or Submit. Used only when the owner switched it on.
// ---------------------------------------------------------------------------------------------------------------------------
export type AdvanceOpts = { company: string; allowSubmit: boolean; baselineConfirmed: boolean };
export type Advance = { kind: "confirmed"; text: string } | { kind: "blocked"; why: string } | { kind: "clicked"; button: string; final: boolean };

const SUBMIT_BTN = /^(submit( my)?( the)?( application)?|apply( now)?|send( my)?( the)?( application)?|finish|complete( application)?|confirm and submit|submit (&|and) apply)$/i;
const NEXT_BTN = /^(next|continue|save (and|&) continue|save (and|&) next|proceed|review( and submit)?)$/i;
const CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="captcha"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]';

const buttonText = (el: Element) => ((el as HTMLInputElement).value || (el as HTMLElement).innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
function windowRoot(): ParentNode { return [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].find(visible) ?? document; }
function findButton(re: RegExp): HTMLElement | null {
  const all = [...windowRoot().querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], [role="button"]')]
    .filter((b) => visible(b) && !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true" && !b.closest("header, nav, [role=search]") && re.test(buttonText(b)));
  return all[all.length - 1] ?? null; // the action button sits last on the page
}

/** Controls that stop the form being sent: what the browser itself calls invalid (required, wrong format), and what the page marks as wrong. */
function incompleteFields(): string[] {
  const out: string[] = [];
  for (const el of windowRoot().querySelectorAll<HTMLInputElement>("input, select, textarea")) {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || el.disabled) continue;
    if (!visible(el) && type !== "file") continue;
    const marked = el.getAttribute("aria-invalid") === "true";
    if (marked || !el.checkValidity()) out.push(clean(type === "radio" ? groupLabelOf(el) : labelOf(el) || groupLabelOf(el)) || el.name || type);
  }
  return [...new Set(out)];
}

const pageText = () => document.body?.innerText ?? "";

/** The employer's own confirmation, when this page shows one that was not already there before Submit (a "thank you for your interest" footer does not count). */
export function confirmedNow(baseline: boolean): string | null {
  const text = pageText();
  if (!CONFIRMATION.test(text)) return null;
  if (baseline && findButton(SUBMIT_BTN)) return null;
  return confirmationSnippet(text, CONFIRMATION);
}

export function pageState(): { url: string; sig: string; confirmationAlready: boolean } {
  const sig = [...document.querySelectorAll("input, select, textarea, button, legend, h1, h2")].filter(visible).map((e) => (e as HTMLInputElement).id || (e as HTMLInputElement).name || text(e)).join("|");
  return { url: location.href, sig, confirmationAlready: CONFIRMATION.test(pageText()) };
}

/**
 * One step of automatic mode on the page as it is now. It never acts on a page it does not trust (a scam, a page that does not name the company and is not a
 * known application system), never on a page with a captcha, a password or any field still empty or invalid; it presses Submit only when allowed.
 */
export function advance(o: AdvanceOpts): Advance {
  const confirmed = confirmedNow(o.baselineConfirmed);
  if (confirmed) return { kind: "confirmed", text: confirmed };
  const trust = destinationTrust({ host: location.hostname, title: document.title, body: pageText(), company: o.company });
  if (!trust.ok) return { kind: "blocked", why: trust.why };
  if ([...document.querySelectorAll(CAPTCHA)].some(visible) || /i'?m not a robot|verify (that )?you are (a )?human/i.test(pageText().slice(0, 20000))) return { kind: "blocked", why: "the page asks for a captcha, which only you can solve" };
  const secret = [...windowRoot().querySelectorAll<HTMLInputElement>("input, textarea")].filter((e) => visible(e) && !e.value && sensitiveKind(clean(labelOf(e)), (e.type || "").toLowerCase())).map((e) => clean(labelOf(e)));
  if (secret.length) return { kind: "blocked", why: `it asks for something only you may type: ${[...new Set(secret)].join("; ")}` };
  const bad = incompleteFields();
  if (bad.length) return { kind: "blocked", why: `not complete: ${bad.slice(0, 6).join("; ")}` };
  const submit = findButton(SUBMIT_BTN);
  if (submit) {
    if (!o.allowSubmit) return { kind: "blocked", why: "the form is complete, but automatic submitting is not allowed right now" };
    const name = buttonText(submit);
    submit.click();
    return { kind: "clicked", button: name, final: true };
  }
  const next = findButton(NEXT_BTN);
  if (next) { const name = buttonText(next); next.click(); return { kind: "clicked", button: name, final: false }; }
  return { kind: "blocked", why: "no Submit or Next button was found on this page" };
}

declare global { interface Window { __careerAgentFill?: (data: FillData) => FillReport; __careerAgentAttach?: (resume: FileSpec | null, cover: FileSpec | null) => AttachReport; __careerAgentAdvance?: (o: AdvanceOpts) => Advance; __careerAgentConfirmed?: (baseline: boolean) => string | null; __careerAgentState?: () => ReturnType<typeof pageState> } }
window.__careerAgentFill = fillPage;
window.__careerAgentAttach = attachFiles;
window.__careerAgentAdvance = advance;
window.__careerAgentConfirmed = confirmedNow;
window.__careerAgentState = pageState;
