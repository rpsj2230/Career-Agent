/** Pure helpers for the apply worker: no browser, no network, fully unit-tested. */

export type Answer = { question: string; answer: string };
export type Applicant = { name: string; email: string; phone: string; location: string; links: string[]; currentCompany?: string };

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

const FAMILIES: [string, RegExp][] = [
  ["notice", /notice\s*period|joining\s*time|how soon/i],
  ["expected_ctc", /expected.*(ctc|salary|compensation|pay)|salary\s*expectation|desired.*(salary|compensation)/i],
  ["current_ctc", /current.*(ctc|salary|compensation|pay)/i],
  ["visa", /visa|work\s*(authori[sz]ation|permit)|authori[sz]ed\s*to\s*work|sponsor/i],
  ["relocate", /relocat/i],
];
const family = (s: string) => FAMILIES.find(([, re]) => re.test(s))?.[0];
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Best answer-bank entry for a form label, or null. Never guesses below a similarity threshold. */
export function matchAnswer(label: string, answers: Answer[]): string | null {
  const fam = family(label);
  if (fam) {
    const hit = answers.find((a) => family(a.question) === fam && a.answer.trim());
    if (hit) return hit.answer;
  }
  const lw = words(label);
  if (lw.size === 0) return null;
  let best: { score: number; answer: string } | null = null;
  for (const a of answers) {
    if (!a.answer.trim()) continue;
    const aw = words(a.question);
    const inter = [...lw].filter((w) => aw.has(w)).length;
    const score = inter / (lw.size + aw.size - inter);
    if (!best || score > best.score) best = { score, answer: a.answer };
  }
  return best && best.score >= 0.5 ? best.answer : null;
}

/** Value for the standard identity fields of a form, matched on label/name text. */
export function standardValue(label: string, a: Applicant): string | null {
  const l = label.toLowerCase();
  const { first, last } = splitName(a.name);
  if (/first\s*name|given\s*name/.test(l)) return first;
  if (/last\s*name|surname|family\s*name/.test(l)) return last;
  // the label must BE a name field, not merely start with the word "name" ("Name your favourite ...")
  if (/^\s*(your\s*|full\s*|legal\s*)*name\s*[*:]*\s*$/.test(l.replace(/\sq\d+$/, "")) || /\b(full|legal)\s*name\b/.test(l)) return a.name;
  if (/e-?mail/.test(l)) return a.email;
  if (/phone|mobile|contact\s*number/.test(l)) return a.phone;
  if (/linkedin/.test(l)) return a.links.find((u) => /linkedin\.com/i.test(u)) ?? null;
  if (/github/.test(l)) return a.links.find((u) => /github\.com/i.test(u)) ?? null;
  if (/\bportfolio\b|\bwebsite\b|personal\s*site|\burl\b/.test(l)) return a.links.find((u) => !/linkedin\.com/i.test(u)) ?? null;
  if (/current\s*(company|employer)/.test(l)) return a.currentCompany ?? null;
  if (/\blocation\b|\bcity\b|where.*(based|located)/.test(l) && !/relocat/.test(l)) return a.location || null;
  return null;
}

export const CONFIRMATION = /thank\s*you\s*for\s*(applying|your\s*application)|application\s*(has\s*been\s*)?(submitted|received|sent)|successfully\s*(applied|submitted)|we('|’)ve\s*received\s*your\s*application/i;

/** Things the worker must never try to work around. */
export type Block = "captcha" | "checkpoint" | "login" | null;
export function detectBlock(url: string, bodyText: string, hasCaptchaFrame: boolean): Block {
  if (/linkedin\.com\/(checkpoint|authwall|uas\/)/i.test(url) || /unusual\s*activity|security\s*verification|verify\s*it'?s\s*you|temporarily\s*restricted/i.test(bodyText)) return "checkpoint";
  if (hasCaptchaFrame) return "captcha";
  if (/\/(login|signin|sign-in)\b/i.test(url)) return "login";
  return null;
}
