import { basename } from "node:path";
import type { Locator, Page } from "playwright";
import type { FieldEntry } from "../src/lib/apply/submission";
import { asCount, wantsNumber, yearsSkill } from "../src/lib/apply/skill-years";
import { sensitiveKind, type Sensitive } from "../src/lib/apply/safety";
import { languageAnswer } from "../src/lib/apply/languages";
import { matchAnswer, standardValue, type Answer, type Applicant } from "./match";

export type FillContext = {
  applicant: Applicant; answers: Answer[]; resumePath: string; coverPath?: string;
  /** years of work with a named tool, when the profile itself shows it (never a guess); asked after the saved answers */
  skillYears?: (skill: string) => string | null;
  /** the owner's default for a tool the profile cannot back; used only when nothing else answers */
  defaultYears?: (skill: string) => string | null;
  /** the languages the owner knows ("English: fluent; Hindi: fluent"); a language not on the line is answered as none */
  languages?: string;
};
/** A question the rules could not answer, with what is needed to answer it from the profile. */
export type Pending = { label: string; type: "text" | "textarea" | "select" | "radio" | "number"; options: string[]; required: boolean };
/** A field that asks for a secret (a password, payment or identity number, a code): never filled and never offered as a question. */
export type Blocked = { kind: Sensitive; label: string };
export type FillResult = { filled: string[]; unanswered: string[]; entries: FieldEntry[]; pending: Pending[]; blocked: Blocked[] };

/** Required boxes that only agree to the site's terms, privacy policy or data use, or confirm the application is true. They are ticked, because submitting is the point. */
export const CONSENT_BOX = /\b(i\s+(have\s+read|agree|accept|consent|acknowledge|understand|confirm|certify|authori[sz]e)|terms|privacy|consent|data\s+(protection|processing)|gdpr|agree|acknowledg|accurate|true\s+and\s+(correct|complete)|declaration)\b/i;

type Field = {
  idx: number; tag: string; type: string; label: string; name: string; required: boolean;
  options: { text: string; value: string; idx: number }[]; hasValue: boolean; combo?: boolean; /** what the control shows now (select: the chosen option; groups: the chosen options) */ current?: string;
};

/** Scan the page (or Easy Apply modal) for fillable controls, tagging each with data-ca-i. Radios are grouped by name. */
export async function scan(page: Page, scope?: string): Promise<Field[]> {
  return page.evaluate((scopeSel) => {
    // with a scope (LinkedIn's Easy Apply window) only the controls inside it count: the page's own search boxes are not part of the application
    const shown = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden"; };
    const rootEl = scopeSel ? [...document.querySelectorAll(scopeSel)].find(shown) ?? null : null; // the first window that is actually showing, not a hidden one earlier on the page
    if (scopeSel && !rootEl) return [] as Field[];
    const root: ParentNode = rootEl ?? document;
    // multi-step forms are scanned once per step: tags from the previous step must go, or two controls share an index
    document.querySelectorAll("[data-ca-i]").forEach((e) => e.removeAttribute("data-ca-i"));
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return s.visibility !== "hidden" && s.display !== "none" && (r.width > 0 || r.height > 0 || (el as HTMLInputElement).type === "file");
    };
    const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const labelOf = (el: HTMLInputElement) => {
      if (el.getAttribute("aria-label")) return el.getAttribute("aria-label")!;
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ");
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return text(l); }
      const wrap = el.closest("label");
      if (wrap) return text(wrap);
      return el.getAttribute("placeholder") || el.name || "";
    };
    const groupLabel = (el: HTMLInputElement) => {
      const fs = el.closest("fieldset");
      const legend = fs?.querySelector("legend");
      if (legend) return text(legend);
      const grp = el.closest("[role=radiogroup],[role=group]");
      if (grp?.getAttribute("aria-label")) return grp.getAttribute("aria-label")!;
      const gby = grp?.getAttribute("aria-labelledby");
      if (gby) { const t = gby.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim(); if (t) return t; }
      const prev = el.closest("div")?.parentElement?.querySelector("label,legend,p,span");
      return text(prev ?? null);
    };
    const els = [...root.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((e) => {
      const t = (e.type || "").toLowerCase();
      return !["hidden", "submit", "button", "image", "reset"].includes(t) && !e.disabled && visible(e);
    });
    const out: Field[] = [];
    const radios = new Map<string, Field>();
    // boxes under one question ("Are you eligible to work here?" with a Yes box and a No box) are one question, answered by choosing one of them
    const agreement = /\b(i\s+(have\s+read|agree|accept|consent|acknowledge|understand|confirm|certify|authori[sz]e)|terms|privacy|consent|data\s+(protection|processing)|gdpr|agree|acknowledg|accurate|true\s+and\s+(correct|complete)|declaration)\b/i;
    const boxGroups = new Map<Element, HTMLInputElement[]>();
    for (const el of els) {
      if ((el.type || "").toLowerCase() !== "checkbox") continue;
      const holder = el.closest("fieldset, [role=group], [role=radiogroup]");
      if (holder) boxGroups.set(holder, [...(boxGroups.get(holder) ?? []), el]);
    }
    const grouped = new Map<HTMLInputElement, Element>();
    for (const [holder, boxes] of boxGroups) {
      if (boxes.length < 2 || boxes.every((b) => agreement.test(labelOf(b))) || !groupLabel(boxes[0])) continue;
      boxes.forEach((b) => grouped.set(b, holder));
    }
    const boxFields = new Map<Element, Field>();
    els.forEach((el, n) => {
      el.setAttribute("data-ca-i", String(n));
      const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();
      const req = el.required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(labelOf(el));
      const holder = grouped.get(el);
      if (holder) {
        let g = boxFields.get(holder);
        if (!g) {
          g = { idx: n, tag: "checkboxgroup", type: "checkboxgroup", label: groupLabel(el), name: el.name, required: req, options: [], hasValue: false };
          boxFields.set(holder, g); out.push(g);
        }
        g.options.push({ text: labelOf(el), value: el.value, idx: n });
        g.required ||= req;
        g.hasValue ||= el.checked;
        if (el.checked) g.current = [g.current, labelOf(el)].filter(Boolean).join(" | ");
        return;
      }
      if (type === "radio") {
        const key = el.name || `r${n}`;
        let g = radios.get(key);
        if (!g) {
          g = { idx: n, tag: "radio", type, label: groupLabel(el), name: key, required: req, options: [], hasValue: false };
          radios.set(key, g); out.push(g);
        }
        g.options.push({ text: labelOf(el), value: el.value, idx: n });
        g.required ||= req;
        g.hasValue ||= el.checked;
        return;
      }
      // a dropdown's first entry is often a prompt ("Select an option") with a value of its own: it is not an answer, and not a choice
      const prompt = (o: { text: string; value: string }) => o.value === "" || /^\s*(please\s+)?(select|choose)\b[^a-z0-9]*(an?\s+)?(option|one|\.\.\.)?[^a-z0-9]*$|^\s*[-–—]+\s*(select|choose)?[^a-z0-9]*$/i.test(o.text);
      const all = type === "select" ? [...(el as unknown as HTMLSelectElement).options].map((o, k) => ({ text: o.text.trim(), value: o.value, idx: k })) : [];
      const options = all.filter((o) => !prompt(o));
      const chosen = type === "select" ? (el as unknown as HTMLSelectElement).selectedOptions[0] : null;
      const hasValue = type === "checkbox" ? el.checked : type === "select" ? !!chosen && !prompt({ text: chosen.text.trim(), value: chosen.value }) : !!el.value;
      out.push({ idx: n, tag: el.tagName.toLowerCase(), type, label: labelOf(el), name: el.name, required: req, options, hasValue, current: type === "select" ? (chosen?.text ?? "").trim() : type === "checkbox" ? (el.checked ? "yes" : "") : el.value, combo: el.getAttribute("role") === "combobox" || !!el.getAttribute("aria-autocomplete") });
    });
    return out;
  }, scope);
}

/**
 * A suggestion box ("typeahead") only accepts a choice from its list: text typed into it is refused ("Please enter a valid answer"). After typing, the matching
 * suggestion is pressed. When no suggestion appears the text stays as typed.
 */
async function pickSuggestion(page: Page, input: Locator, value: string): Promise<void> {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const options = page.locator('[role="option"]:visible');
  const ready = await options.first().waitFor({ state: "visible", timeout: 1800 }).then(() => true, () => false);
  if (!ready) return;
  const best = options.filter({ hasText: new RegExp(esc, "i") }).first();
  const pick = (await best.count().catch(() => 0)) ? best : options.first();
  await pick.click({ timeout: 2000 }).catch(async () => { await input.press("ArrowDown").catch(() => undefined); await input.press("Enter").catch(() => undefined); });
}

/** Tick a box. Many sites hide the real checkbox behind a styled one, so a plain check() times out: then force it, and as a last resort click it in the page. */
async function tick(box: Locator): Promise<void> {
  const done = () => box.isChecked().catch(() => false);
  try { await box.check({ timeout: 4000 }); if (await done()) return; } catch { /* styled or covered checkbox */ }
  try { await box.check({ force: true, timeout: 3000 }); if (await done()) return; } catch { /* hidden checkbox */ }
  await box.evaluate((el) => { const c = el as HTMLInputElement; if (!c.checked) c.click(); });
  if (!(await done())) throw new Error("the box could not be ticked");
}

/** A label without its required star, and without the doubling some sites produce (a visible label plus the same words again for screen readers). */
export const clean = (s: string) => {
  const t = s.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
  for (let n = Math.floor(t.length / 2); n >= 6; n--) { if (t.length === 2 * n || t.length === 2 * n + 1) { const a = t.slice(0, n).trim(), b = t.slice(t.length - n).trim(); if (a === b) return a; } }
  return t;
};
const yesNo = (answer: string) => (/^\s*(yes|y|true)\b/i.test(answer) ? "yes" : /^\s*(no|n|false)\b/i.test(answer) ? "no" : null);

function pickOption(options: { text: string }[], answer: string): number {
  const a = answer.toLowerCase();
  const yn = yesNo(answer);
  let i = options.findIndex((o) => o.text.toLowerCase() === a);
  if (i < 0 && yn) i = options.findIndex((o) => o.text.toLowerCase().startsWith(yn));
  if (i < 0) i = options.findIndex((o) => o.text.toLowerCase().includes(a) || a.includes(o.text.toLowerCase()));
  return i;
}

/**
 * Fill every control we can answer from the profile or answer bank. Anything required that we cannot answer
 * (including consent/terms checkboxes, which you must tick yourself) is reported in `unanswered`, and the
 * caller must NOT submit.
 */
export async function fillForm(page: Page, ctx: FillContext, scope?: string): Promise<FillResult> {
  const fields = await scan(page, scope);
  const filled: string[] = [];
  const unanswered: string[] = [];
  const entries: FieldEntry[] = [];
  const pending: Pending[] = [];
  const blocked: Blocked[] = [];
  const ask = (f: Field, label: string) => {
    if (!f.required) return;
    unanswered.push(label);
    const t = f.type === "textarea" ? "textarea" : f.type === "select" ? "select" : f.type === "radio" ? "radio" : f.type === "number" || wantsNumber(label) ? "number" : "text";
    pending.push({ label, type: t, options: f.options.map((o) => o.text), required: true });
  };
  const at = (i: number) => page.locator(`[data-ca-i="${i}"]`);
  let fileCount = 0;

  for (const f of fields) {
    const label = clean(f.label || f.name);
    const probe = `${label} ${f.name}`;
    const secret = f.type === "file" || f.type === "checkbox" ? null : sensitiveKind(label || f.name, f.type);
    if (secret) { blocked.push({ kind: secret, label: label || f.name }); continue; }
    try {
      if (f.type === "file") {
        const wantsCover = /cover/i.test(probe);
        const wantsResume = /resume|cv|curriculum/i.test(probe);
        const path = wantsCover ? ctx.coverPath : wantsResume || fileCount === 0 ? ctx.resumePath : ctx.coverPath;
        fileCount++;
        if (path) { await at(f.idx).setInputFiles(path); filled.push(`${label || "file"} (upload)`); entries.push({ label: label || "file", value: basename(path), kind: "file", source: "upload" }); }
        else if (f.required) unanswered.push(label || "file upload");
        continue;
      }
      if (f.type === "checkboxgroup") {
        if (f.hasValue) continue;
        const answer = matchAnswer(f.label, ctx.answers) ?? languageAnswer(label, f.options.map((o) => o.text), ctx.languages);
        const i = answer ? pickOption(f.options, answer) : -1;
        if (i >= 0) { await tick(at(f.options[i].idx)); filled.push(label); entries.push({ label, value: f.options[i].text, kind: "checkbox", source: "answers" }); }
        else ask({ ...f, type: "radio" }, label);
        continue;
      }
      if (f.type === "checkbox") {
        if (f.required && !f.hasValue) {
          if (CONSENT_BOX.test(label)) { await tick(at(f.idx)); filled.push(label); entries.push({ label, value: "ticked", kind: "checkbox", source: "profile" }); }
          else unanswered.push(`${label} (a required box that is not a plain agreement)`);
        }
        continue;
      }
      if (f.hasValue) continue;
      // the visible label decides first (a field named "_systemfield_name" labelled "Name"); the field's own name is the fallback
      const langAns = languageAnswer(label, f.options.map((o) => o.text), ctx.languages);
      const std = standardValue(label, ctx.applicant) ?? standardValue(probe, ctx.applicant);
      const banked = std ?? matchAnswer(label, ctx.answers);
      const skill = banked == null ? yearsSkill(label) : null;
      const derived = skill ? ctx.skillYears?.(skill) ?? null : null;
      const standing = skill && derived == null ? ctx.defaultYears?.(skill) ?? null : null;
      const raw = banked ?? derived ?? standing ?? langAns;
      // a count asked for in a box is written as a number: "3 years" would be refused
      const value = raw != null && f.type !== "select" && wantsNumber(label) ? asCount(raw) : raw;
      const source: FieldEntry["source"] = std != null || derived != null || (banked == null && standing == null && langAns != null) ? "profile" : standing != null ? "rule" : "answers";

      if (f.type === "radio") {
        const answer = matchAnswer(f.label, ctx.answers) ?? languageAnswer(label, f.options.map((o) => o.text), ctx.languages);
        const i = answer ? pickOption(f.options, answer) : -1;
        if (i >= 0) { await at(f.options[i].idx).check(); filled.push(label); entries.push({ label, value: f.options[i].text, kind: "radio", source: "answers" }); }
        else ask(f, label);
        continue;
      }
      if (f.type === "select") {
        const i = value ? pickOption(f.options, value) : -1;
        if (i >= 0) { await at(f.idx).selectOption({ index: f.options[i].idx }); filled.push(label); entries.push({ label, value: f.options[i].text, kind: "select", source }); }
        else ask(f, label);
        continue;
      }
      if (value) { await at(f.idx).fill(value); if (f.combo) await pickSuggestion(page, at(f.idx), value); filled.push(label); entries.push({ label, value, kind: "text", source }); }
      else ask(f, label);
    } catch (e) {
      if (f.required) unanswered.push(`${label} (${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
    }
  }
  return { filled, unanswered, entries, pending, blocked };
}

/**
 * Click the form's submit control. The form's own submit button comes first, then a button that says submit/send, and only
 * as a last resort a bare "Apply" (which on many job pages is just a link down to the form). Returns false when none exists.
 */
export async function clickSubmit(page: Page, scope?: string): Promise<boolean> {
  // inside LinkedIn's Easy Apply window only that window's own button counts: the page around it has a search box and a messaging "Send" button that are not the application
  if (scope) {
    const root = page.locator(`${scope} >> visible=true`).first();
    for (const c of [root.getByRole("button", { name: /submit application|send application/i }), root.locator('input[type="submit"], button[type="submit"]'), root.getByRole("button", { name: /^\s*(submit|send)\s*$/i })]) {
      const first = c.first();
      if (await first.isVisible().catch(() => false)) { await first.click(); return true; }
    }
    return false;
  }
  const candidates = [
    page.locator('form input[type="submit"], form button[type="submit"]'),
    page.getByRole("button", { name: /submit application|send application|submit|send/i }),
    page.getByRole("button", { name: /^\s*apply\b/i }),
  ];
  for (const c of candidates) {
    const first = c.first();
    if (await first.isVisible().catch(() => false)) { await first.click(); return true; }
  }
  return false;
}

/**
 * True when the page shows a search box (a job board's "what / where" form) and no application form. Such a page is a listing or search
 * result, not an application: nothing must be typed into it and its button must not be pressed.
 */
export async function looksLikeSearchForm(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== "hidden"; };
    const searchy = (f: Element) => {
      const btn = f.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], button:not([type])');
      const btnText = ((btn as HTMLInputElement | null)?.value || btn?.textContent || "").trim();
      return f.getAttribute("role") === "search" || /search/i.test(`${f.id} ${f.className} ${f.getAttribute("action") ?? ""}`) || !!f.querySelector('input[type="search"]')
        || /search/i.test(btn?.id ?? "") || /^(search|find)\b/i.test(btnText);
    };
    const forms = [...document.querySelectorAll("form")].filter(visible);
    const application = forms.some((f) => !searchy(f) && (!!f.querySelector('input[type="file"]') || [...f.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select")].filter(visible).length >= 3));
    if (application) return false;
    return forms.some(searchy) || [...document.querySelectorAll('input[type="search"]')].some(visible);
  });
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Did the page keep what was typed? Tolerant of formatting (a phone number reformatted, a choice shown with extra words); it only objects when the value is gone or unrelated. */
export function keptValue(expected: string, actual: string): boolean {
  const e = alnum(expected), a = alnum(actual);
  if (!a) return false;
  if (!e) return true;
  if (a.includes(e) || e.includes(a)) return true;
  const digits = (x: string) => x.replace(/\D+/g, "");
  return digits(expected).length >= 6 && digits(expected).endsWith(digits(actual).slice(-8));
}

/**
 * Read the form back after filling it and compare with what was entered. A page's own scripts sometimes clear or reformat a value, and a form submitted with a blank where an answer
 * was typed is a wrong application. Returns the answers the page did not keep (label, what was entered, what the page shows). Files and secrets are never read.
 */
export async function verifyEntries(page: Page, entries: FieldEntry[], scope?: string): Promise<{ label: string; expected: string; actual: string }[]> {
  const fields = await scan(page, scope);
  const byLabel = new Map(fields.map((f) => [clean(f.label || f.name), f]));
  const bad: { label: string; expected: string; actual: string }[] = [];
  for (const e of entries) {
    if (e.kind === "file" || e.kind === "checkbox" && e.value === "ticked") continue;
    const f = byLabel.get(clean(e.label));
    if (!f || f.type === "file" || f.type === "password") continue;
    const actual = f.current ?? "";
    if (!keptValue(e.value, actual)) bad.push({ label: e.label, expected: e.value, actual });
  }
  return bad;
}
