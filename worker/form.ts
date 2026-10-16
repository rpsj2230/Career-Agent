import { basename } from "node:path";
import type { Page } from "playwright";
import type { FieldEntry } from "../src/lib/apply/submission";
import { matchAnswer, standardValue, type Answer, type Applicant } from "./match";

export type FillContext = { applicant: Applicant; answers: Answer[]; resumePath: string; coverPath?: string };
export type FillResult = { filled: string[]; unanswered: string[]; entries: FieldEntry[] };

type Field = {
  idx: number; tag: string; type: string; label: string; name: string; required: boolean;
  options: { text: string; value: string; idx: number }[]; hasValue: boolean;
};

/** Scan the page (or Easy Apply modal) for fillable controls, tagging each with data-ca-i. Radios are grouped by name. */
async function scan(page: Page): Promise<Field[]> {
  return page.evaluate(() => {
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
    const els = [...document.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((e) => {
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
  });
}

const clean = (s: string) => s.replace(/[*✱]/g, "").replace(/\s+/g, " ").trim();
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
export async function fillForm(page: Page, ctx: FillContext): Promise<FillResult> {
  const fields = await scan(page);
  const filled: string[] = [];
  const unanswered: string[] = [];
  const entries: FieldEntry[] = [];
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
        if (f.required && !f.hasValue) unanswered.push(`${label} (you must tick this yourself)`);
        continue;
      }
      if (f.hasValue) continue;
      const std = standardValue(probe, ctx.applicant);
      const value = std ?? matchAnswer(label, ctx.answers);
      const source: FieldEntry["source"] = std != null ? "profile" : "answers";

      if (f.type === "radio") {
        const answer = matchAnswer(f.label, ctx.answers);
        const i = answer ? pickOption(f.options, answer) : -1;
        if (i >= 0) { await at(f.options[i].idx).check(); filled.push(label); entries.push({ label, value: f.options[i].text, kind: "radio", source: "answers" }); }
        else if (f.required) unanswered.push(label);
        continue;
      }
      if (f.type === "select") {
        const i = value ? pickOption(f.options, value) : -1;
        if (i >= 0) { await at(f.idx).selectOption({ index: f.options[i].idx }); filled.push(label); entries.push({ label, value: f.options[i].text, kind: "select", source }); }
        else if (f.required) unanswered.push(label);
        continue;
      }
      if (value) { await at(f.idx).fill(value); filled.push(label); entries.push({ label, value, kind: "text", source }); }
      else if (f.required) unanswered.push(label);
    } catch (e) {
      if (f.required) unanswered.push(`${label} (${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
    }
  }
  return { filled, unanswered, entries };
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
