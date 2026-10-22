import { matchAnswer, standardValue, type Answer } from "../../worker/match";
import { languageAnswer } from "../../src/lib/apply/languages";
import { CONSENT_BOX } from "../../src/lib/apply/consent";
import { sensitiveKind } from "../../src/lib/apply/safety";
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

declare global { interface Window { __careerAgentFill?: (data: FillData) => FillReport } }
window.__careerAgentFill = fillPage;
