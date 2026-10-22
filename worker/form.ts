import { basename } from "node:path";
import type { Locator, Page } from "playwright";
import type { FieldEntry } from "../src/lib/apply/submission";
import { asCount, wantsNumber, yearsSkill } from "../src/lib/apply/skill-years";
import { matchAnswer, standardValue, type Answer, type Applicant } from "./match";

export type FillContext = {
  applicant: Applicant; answers: Answer[]; resumePath: string; coverPath?: string;
  /** years of work with a named tool, when the profile itself shows it (never a guess); asked after the saved answers */
  skillYears?: (skill: string) => string | null;
};
/** A question the rules could not answer, with what is needed to answer it from the profile. */
export type Pending = { label: string; type: "text" | "textarea" | "select" | "radio" | "number"; options: string[]; required: boolean };
export type FillResult = { filled: string[]; unanswered: string[]; entries: FieldEntry[]; pending: Pending[] };

/** Required boxes that only agree to the site's terms, privacy policy or data use, or confirm the application is true. They are ticked, because submitting is the point. */
export const CONSENT_BOX = /\b(i\s+(have\s+read|agree|accept|consent|acknowledge|understand|confirm|certify|authori[sz]e)|terms|privacy|consent|data\s+(protection|processing)|gdpr|agree|acknowledg|accurate|true\s+and\s+(correct|complete)|declaration)\b/i;

type Field = {
  idx: number; tag: string; type: string; label: string; name: string; required: boolean;
  options: { text: string; value: string; idx: number }[]; hasValue: boolean;
};

/** Scan the page (or Easy Apply modal) for fillable controls, tagging each with data-ca-i. Radios are grouped by name. */
async function scan(page: Page, scope?: string): Promise<Field[]> {
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
      const prev = el.closest("div")?.parentElement?.querySelector("label,legend,p,span");
      return text(prev ?? null);
    };
    const els = [...root.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((e) => {
      const t = (e.type || "").toLowerCase();
      return !["hidden", "submit", "button", "image", "reset"].includes(t) && !e.disabled && visible(e);
    });
    const out: Field[] = [];
    const radios = new Map<string, Field>();
    els.forEach((el, n) => {
      el.setAttribute("data-ca-i", String(n));
      const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.type || "text").toLowerCase();
      const req = el.required || el.getAttribute("aria-required") === "true" || /[*✱]/.test(labelOf(el));
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
      const options = type === "select"
        ? [...(el as unknown as HTMLSelectElement).options].map((o, k) => ({ text: o.text.trim(), value: o.value, idx: k })).filter((o) => o.value !== "")
        : [];
      out.push({ idx: n, tag: el.tagName.toLowerCase(), type, label: labelOf(el), name: el.name, required: req, options, hasValue: type === "checkbox" ? el.checked : !!el.value });
    });
    return out;
  }, scope);
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
      if (f.type === "checkbox") {
        if (f.required && !f.hasValue) {
          if (CONSENT_BOX.test(label)) { await tick(at(f.idx)); filled.push(label); entries.push({ label, value: "ticked", kind: "checkbox", source: "profile" }); }
          else unanswered.push(`${label} (a required box that is not a plain agreement)`);
        }
        continue;
      }
      if (f.hasValue) continue;
      // the visible label decides first (a field named "_systemfield_name" labelled "Name"); the field's own name is the fallback
      const std = standardValue(label, ctx.applicant) ?? standardValue(probe, ctx.applicant);
      const banked = std ?? matchAnswer(label, ctx.answers);
      const skill = banked == null ? yearsSkill(label) : null;
      const derived = skill ? ctx.skillYears?.(skill) ?? null : null;
      const raw = banked ?? derived;
      // a count asked for in a box is written as a number: "3 years" would be refused
      const value = raw != null && f.type !== "select" && wantsNumber(label) ? asCount(raw) : raw;
      const source: FieldEntry["source"] = std != null || derived != null ? "profile" : "answers";

      if (f.type === "radio") {
        const answer = matchAnswer(f.label, ctx.answers);
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
      if (value) { await at(f.idx).fill(value); filled.push(label); entries.push({ label, value, kind: "text", source }); }
      else ask(f, label);
    } catch (e) {
      if (f.required) unanswered.push(`${label} (${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
    }
  }
  return { filled, unanswered, entries, pending };
}

/**
 * Click the form's submit control. The form's own submit button comes first, then a button that says submit/send, and only
 * as a last resort a bare "Apply" (which on many job pages is just a link down to the form). Returns false when none exists.
 */
export async function clickSubmit(page: Page): Promise<boolean> {
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
