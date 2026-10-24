import { CONFIRMATION, matchAnswer, standardValue, type Answer } from "../../worker/match";
import { languageAnswer } from "../../src/lib/apply/languages";
import { CONSENT_BOX } from "../../src/lib/apply/consent";
import { destinationTrust, sensitiveKind } from "../../src/lib/apply/safety";
import { confirmationSnippet } from "../../src/lib/apply/submission";
import { declineOption } from "../../src/lib/apply/demographics";
import { asCount, defaultToolYears, skillYears, wantsNumber, yearsSkill } from "../../src/lib/apply/skill-years";
import type { FillData } from "../../src/lib/apply/fill-data";
import type { MasterProfile } from "../../src/lib/types";
import "./sites";

/**
 * Fills the form on the page you are looking at, from your own data, and stops. It never presses a button, never submits, never types a password, a payment or an identity number,
 * and leaves a field alone when it already has something in it. What it could not answer is outlined in orange and listed for you.
 */
/** A question the page asks that your data has no answer for: its wording, the options it offers (when it offers any), and what kind of control it is. */
export type Question = { label: string; options: string[]; kind: "text" | "select" | "radio" | "checkbox" | "dropdown"; required: boolean };
export type FillReport = { filled: string[]; forYou: string[]; secret: string[]; questions: Question[] };

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
/** The label of a radio button or checkbox, whose own input is often hidden (zero size) while the label is what is shown and clicked. */
const labelFor = (el: HTMLInputElement): HTMLElement | null => (el.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`) : null) ?? el.closest("label");
/** Shown to the person: the control itself, or (for a radio button or checkbox) its label. */
const shown = (el: HTMLInputElement): boolean => visible(el) || ((el.type === "radio" || el.type === "checkbox") && !!labelFor(el) && visible(labelFor(el)!));
/** Tick a radio button or checkbox the way a person would: the label when the input itself is hidden, then the input if that did not do it. */
function tick(el: HTMLInputElement) {
  const l = labelFor(el);
  if (!visible(el) && l) l.click(); else el.click();
  if (!el.checked) el.click();
}
/** The boxes that belong together: those in the same fieldset or group, or sharing a name. */
function boxGroup(el: HTMLInputElement, root: ParentNode): HTMLInputElement[] {
  const holder = el.closest("fieldset, [role=group], [role=radiogroup]");
  const members = holder ? [...holder.querySelectorAll<HTMLInputElement>('input[type=checkbox]')] : el.name ? [...root.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${CSS.escape(el.name)}"]`)] : [el];
  return members.filter(shown);
}
const flag = (el: Element) => { (el as HTMLElement).style.outline = "2px solid #f97316"; (el as HTMLElement).style.outlineOffset = "2px"; };

/** What to answer for a question, from your own data: the standard fields, your saved answers, years with a tool, languages, a phone country code. null when there is no answer. */
function makeValueFor(data: FillData): (label: string, options: string[]) => string | null {
  const profile = { experience: data.experience.map((e, i) => ({ id: `e${i}`, company: "", title: e.title, start: e.start, end: e.end, bullets: e.bullets.map((t, j) => ({ id: `b${i}.${j}`, text: t })) })) } as unknown as MasterProfile;
  const answers: Answer[] = data.answers;
  const dial = (data.applicant.phone.match(/^\s*\+\s*(\d{1,3})/) ?? [])[1];
  return (label, options) => {
    if (dial && /country\s*code|dial(l?ing)?\s*code|phone\s*code/i.test(label)) return `+${dial}`;
    if (/^\s*(current\s+)?(country|country\s+of\s+residence|country\s*\/\s*region)\s*[*:]*\s*$/i.test(label)) { const where = data.applicant.location.split(",").pop()?.trim(); if (where) return where; }
    const std = standardValue(label, data.applicant);
    if (std) return std;
    const banked = matchAnswer(label, answers);
    if (banked) return banked;
    const skill = yearsSkill(label);
    if (skill) return skillYears(profile, skill) ?? defaultToolYears(profile, skill);
    return languageAnswer(label, options, data.languages) ?? declineOption(label, options);
  };
}

export function fillPage(data: FillData): FillReport {
  const out: FillReport = { filled: [], forYou: [], secret: [], questions: [] };
  // inside a window (a dialog) only its own fields count; otherwise the whole page
  const root: ParentNode = windowRoot();
  const controls = [...root.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((e) => {
    const t = (e.type || "").toLowerCase();
    return !["hidden", "submit", "button", "image", "reset", "file"].includes(t) && !e.disabled && !e.readOnly && shown(e) && !e.closest("header, nav, [role=search]");
  });
  const done = new Set<string>();
  const valueFor = makeValueFor(data);
  const unanswered = (q: Question, els: Element[]) => { if (q.required) { out.forYou.push(q.label); els.forEach(flag); out.questions.push(q); } };
  for (const el of controls) {
    const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();
    const grouped = type === "radio" || type === "checkbox";
    const required = el.required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(labelOf(el)) || (grouped && /[*✱]/.test(groupLabelOf(el))) || !!el.closest("[aria-required=true]");
    if (type === "radio") {
      const group = el.name || labelOf(el); if (done.has(group)) continue; done.add(group);
      const members = [...root.querySelectorAll<HTMLInputElement>(`input[type=radio]${el.name ? `[name="${CSS.escape(el.name)}"]` : ""}`)].filter(shown);
      if (members.some((m) => m.checked)) continue;
      const label = clean(groupLabelOf(el)); const opts = members.map((m) => clean(labelOf(m)));
      const v = label ? valueFor(label, opts) : null; const i = v ? pick(opts, v) : -1;
      if (i >= 0) { tick(members[i]); out.filled.push(label); } else if (label) unanswered({ label, options: opts, kind: "radio", required }, members);
      continue;
    }
    if (type === "checkbox") {
      const group = boxGroup(el, root);
      if (group.length >= 2) { // "select all that apply": one question, several boxes
        const key = group[0].name || group[0].id || clean(groupLabelOf(el)); if (done.has(key)) continue; done.add(key);
        if (group.some((m) => m.checked)) continue;
        const label = clean(groupLabelOf(el)); const opts = group.map((m) => clean(labelOf(m)));
        const v = label ? valueFor(label, opts) : null;
        const chosen = v ? [...new Set(v.split(/[;,]|\band\b/i).map((part) => pick(opts, part.trim())).filter((i) => i >= 0))] : [];
        if (chosen.length) { chosen.forEach((i) => tick(group[i])); out.filled.push(label); } else if (label) unanswered({ label, options: opts, kind: "checkbox", required }, group);
        continue;
      }
      const label = clean(labelOf(el));
      if (el.checked || !label) continue;
      if (required && CONSENT_BOX.test(label)) { tick(el); out.filled.push(label); continue; }
      const v = valueFor(label, ["Yes", "No"]); // a single box that states something ("I am willing to relocate"): ticked when your data says yes
      if (v && /^\s*(yes|true|y)\b/i.test(v)) { tick(el); out.filled.push(label); }
      else if (required) { out.forYou.push(`${label} (a box that is not a plain agreement)`); flag(el); out.questions.push({ label, options: ["Yes", "No"], kind: "checkbox", required }); }
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
    const q: Question = { label, options, kind: type === "select" ? "select" : "text", required };
    if (v == null) { unanswered(q, [el]); continue; }
    if (type === "select") {
      const sel = el as unknown as HTMLSelectElement; const i = pick([...sel.options].map((o) => o.text.trim()), v);
      if (i >= 0) { setValue(sel, sel.options[i].value); out.filled.push(label); } else unanswered(q, [el]);
    } else { setValue(el, v); out.filled.push(label); }
  }
  return out;
}

/** The questions the page itself says are unanswered or invalid (after a Next that did not go on): their wording and options, so they can be looked up. */
export function invalidQuestions(): Question[] {
  const root = windowRoot();
  const out: Question[] = [];
  const seen = new Set<string>();
  const shownError = (el: Element) => { let p: Element | null = el.closest("fieldset, [role=group], [role=radiogroup]") ?? el.parentElement?.parentElement ?? null; return !!p && [...p.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i]')].some((e) => visible(e) && text(e).length > 0); };
  for (const el of root.querySelectorAll<HTMLInputElement>("input, select, textarea")) {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type) || el.disabled || !shown(el)) continue;
    if (type === "radio" || type === "checkbox" ? (type === "radio" ? !!el.closest("fieldset, [role=radiogroup]")?.querySelector("input:checked") : el.checked) : !!el.value && !/^\s*(select|choose)/i.test((el as unknown as HTMLSelectElement).selectedOptions?.[0]?.text ?? "")) continue;
    if (!(el.getAttribute("aria-invalid") === "true" || !el.checkValidity() || !!el.closest("[aria-invalid=true]") || shownError(el))) continue;
    const group = type === "radio" || type === "checkbox" ? [...(el.closest("fieldset, [role=group], [role=radiogroup]") ?? root as ParentNode).querySelectorAll<HTMLInputElement>(`input[type=${type}]`)].filter(shown) : [];
    const label = clean(type === "radio" || type === "checkbox" ? groupLabelOf(el) : labelOf(el) || groupLabelOf(el));
    if (!label || seen.has(label) || sensitiveKind(label, type)) continue;
    seen.add(label);
    const options = type === "select" ? [...(el as unknown as HTMLSelectElement).options].map((o) => o.text.trim()).filter((t) => t && !/^\s*(please\s+)?(select|choose)\b/i.test(t)) : group.map((m) => clean(labelOf(m)));
    out.push({ label, options, kind: type === "select" ? "select" : type === "radio" ? "radio" : type === "checkbox" ? "checkbox" : "text", required: true });
  }
  for (const t of root.querySelectorAll<HTMLElement>('[role="combobox"][aria-invalid="true"], [aria-haspopup="listbox"][aria-invalid="true"]')) {
    const label = clean(labelOf(t as HTMLInputElement) || groupLabelOf(t as HTMLInputElement));
    if (label && !seen.has(label)) { seen.add(label); out.push({ label, options: [], kind: "dropdown", required: true }); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dropdowns that are not a <select>: a box or button that opens a list of options (role "combobox" or "listbox"), or a box you type into to search a list.
// ---------------------------------------------------------------------------------------------------------------------------
const CUSTOM_DROPDOWN = '[role="combobox"], [aria-haspopup="listbox"], button[aria-haspopup="true"][aria-expanded], div[role="button"][aria-haspopup]';
const PLACEHOLDER = /^\s*(select|choose|please|pick|--|—|–)|^\s*$/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const press = (el: Element, ...types: string[]) => { for (const t of types) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); };
const openOptions = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"], [role="listbox"] li, [role="menu"] [role="menuitem"], [role="listbox"] [role="menuitemradio"]')].filter((o) => visible(o) && text(o));

async function openAndRead(t: HTMLElement): Promise<HTMLElement[]> {
  t.scrollIntoView?.({ block: "center" });
  if (t instanceof HTMLInputElement) t.focus();
  press(t, "mousedown", "mouseup", "click"); // most lists open on mousedown, some on click
  await wait(350);
  let opts = openOptions();
  if (!opts.length) { t.click(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await wait(350); opts = openOptions(); }
  return opts;
}
function closeList(t: HTMLElement) {
  for (const el of [t, document.body]) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  if (openOptions().length) press(document.body, "mousedown", "mouseup", "click");
}

/** Choose the right option in every custom dropdown of the page (or window) that is still empty: the answer comes from the same data as every other field. */
export async function fillDropdowns(data: FillData): Promise<{ filled: string[]; forYou: string[]; questions: Question[] }> {
  const out = { filled: [] as string[], forYou: [] as string[], questions: [] as Question[] };
  const valueFor = makeValueFor(data);
  const root = windowRoot();
  const triggers = [...root.querySelectorAll<HTMLElement>(CUSTOM_DROPDOWN)].filter((t) => visible(t) && !t.closest("header, nav, [role=search], [role=listbox]") && t.getAttribute("aria-disabled") !== "true" && !(t instanceof HTMLSelectElement));
  for (const t of triggers) {
    const raw = labelOf(t as HTMLInputElement) || groupLabelOf(t as HTMLInputElement);
    const label = clean(raw);
    if (!label || sensitiveKind(label, "text")) continue;
    const required = t.getAttribute("aria-required") === "true" || /[*✱]/.test(raw);
    const current = t instanceof HTMLInputElement ? t.value : text(t).replace(label, "").trim();
    if (current && !PLACEHOLDER.test(current)) continue; // it already says something
    let options = await openAndRead(t);
    let names = options.map((o) => text(o));
    let v = valueFor(label, names);
    let i = v ? pick(names, v) : -1;
    if (i < 0 && v && (t instanceof HTMLInputElement || t.querySelector("input"))) { // a box that searches: type the answer and read what it offers
      const box = t instanceof HTMLInputElement ? t : t.querySelector<HTMLInputElement>("input")!;
      setValue(box, v);
      await wait(600);
      options = openOptions(); names = options.map((o) => text(o)); i = pick(names, v);
      if (i < 0 && options.length === 1) i = 0;
    }
    if (i >= 0) { options[i].scrollIntoView?.({ block: "nearest" }); press(options[i], "mousedown", "mouseup", "click"); await wait(250); if (openOptions().length) options[i].click(); out.filled.push(label); }
    else { closeList(t); if (required) { out.forYou.push(label); flag(t); out.questions.push({ label, options: names, kind: "dropdown", required }); } }
    await wait(150);
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
/** A site's own window (a side panel that is not a dialog) can be named by the caller; it is kept on the page itself because this script is injected again before every step. */
type ScopeWindow = Window & { __careerAgentScopeSel?: string | null };
function windowRoot(): ParentNode {
  const named = (window as ScopeWindow).__careerAgentScopeSel;
  const mine = named ? [...document.querySelectorAll(named)].find(visible) : null;
  return mine ?? [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].find(visible) ?? document;
}
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
/** A small box in the corner of the page that says what the extension is doing, with a Stop button. Built in a shadow root, so the site's own styles cannot touch it. null removes it. */
function overlay(message: string | null) {
  let host = document.getElementById("career-agent-overlay");
  if (message === null) { host?.remove(); return; }
  if (!host) {
    host = document.createElement("div");
    host.id = "career-agent-overlay";
    host.style.cssText = "position:fixed;top:72px;right:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ".box{font:13px/1.4 system-ui,sans-serif;width:260px;background:#111418;color:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.35)}.by{font-size:11px;opacity:.7;margin-bottom:6px}b{display:block;font-size:14px}p{margin:6px 0 10px;white-space:pre-wrap;word-break:break-word}button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:6px 12px;background:#fff;color:#111418;cursor:pointer}";
    const box = document.createElement("div"); box.className = "box";
    const title = document.createElement("b"); title.textContent = "Career Agent";
    const by = document.createElement("div"); by.className = "by"; by.textContent = "By Rupash Pratap";
    const msg = document.createElement("p"); msg.id = "m";
    const stop = document.createElement("button"); stop.textContent = "Stop";
    stop.onclick = () => { try { chrome.runtime.sendMessage({ type: "stop-filter" }); } catch { /* the extension was reloaded */ } msg.textContent = "Stopping after the job in hand..."; };
    box.append(title, by, msg, stop);
    root.append(style, box);
    document.documentElement.append(host);
  }
  const m = host.shadowRoot?.getElementById("m");
  if (m) m.textContent = message;
}
declare const chrome: { runtime: { sendMessage(m: unknown): unknown } };
(window as unknown as { __careerAgentOverlay: typeof overlay }).__careerAgentOverlay = overlay;
(window as unknown as { __careerAgentSetScope: (sel: string | null) => void }).__careerAgentSetScope = (sel) => { (window as ScopeWindow).__careerAgentScopeSel = sel; };
window.__careerAgentFill = fillPage;
(window as unknown as { __careerAgentInvalid: typeof invalidQuestions }).__careerAgentInvalid = invalidQuestions;
(window as unknown as { __careerAgentDropdowns: typeof fillDropdowns }).__careerAgentDropdowns = fillDropdowns;
window.__careerAgentAttach = attachFiles;
window.__careerAgentAdvance = advance;
window.__careerAgentConfirmed = confirmedNow;
window.__careerAgentState = pageState;
