/** Pure helpers for the apply worker: no browser, no network, fully unit-tested. */
import { yearsSkill } from "../src/lib/apply/skill-years";

export type Answer = { question: string; answer: string };
export type Applicant = { name: string; email: string; phone: string; location: string; links: string[]; currentCompany?: string };

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

const FAMILIES: [string, RegExp][] = [
  // sponsorship is the OPPOSITE question to "are you authorised": it must never borrow the authorisation answer
  ["sponsorship", /sponsor/i],
  ["notice", /notice\s*period|joining\s*time|how soon/i],
  ["expected_ctc", /expected.*(ctc|salary|compensation|pay)|salary\s*expectation|desired.*(salary|compensation)/i],
  ["current_ctc", /current.*(ctc|salary|compensation|pay)/i],
  ["visa", /visa|work\s*(authori[sz]ation|permit)|authori[sz]ed\s*to\s*work|eligible\s*to\s*work|right\s*to\s*work/i],
  ["relocate", /relocat/i],
];
/** Country and nationality words a question can contain ("authorised to work in Singapore", "Indian citizen"). */
const COUNTRY_WORDS: Record<string, string> = {
  india: "in", indian: "in", singapore: "sg", singaporean: "sg", uae: "ae", emirates: "ae", dubai: "ae", australia: "au", australian: "au", "new zealand": "nz",
  uk: "gb", "united kingdom": "gb", british: "gb", england: "gb", ireland: "ie", irish: "ie", usa: "us", "united states": "us", america: "us", american: "us",
  canada: "ca", canadian: "ca", germany: "de", german: "de", netherlands: "nl", dutch: "nl", france: "fr", french: "fr", spain: "es", italy: "it", switzerland: "ch",
  hong: "hk", malaysia: "my", japan: "jp", qatar: "qa", "saudi arabia": "sa", eu: "eu", "european union": "eu",
};
export function countriesIn(text: string): Set<string> {
  const l = text.toLowerCase();
  return new Set(Object.entries(COUNTRY_WORDS).filter(([w]) => new RegExp(`\\b${w}\\b`).test(l)).map(([, code]) => code));
}
/** Work-authorisation answers are only reusable for the country they were written for. */
function sameCountryScope(question: string, bankQuestion: string): boolean {
  const asked = countriesIn(question);
  if (asked.size === 0) return true;
  const answered = countriesIn(bankQuestion);
  return [...asked].every((c) => answered.has(c));
}
const family = (s: string) => FAMILIES.find(([, re]) => re.test(s))?.[0];
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));

/** Best answer-bank entry for a form label, or null. Never guesses below a similarity threshold. */
export function matchAnswer(label: string, answers: Answer[]): string | null {
  const fam = family(label);
  if (fam) {
    const hit = answers.find((a) => family(a.question) === fam && a.answer.trim() && (fam !== "visa" || sameCountryScope(label, a.question)));
    if (hit) return hit.answer;
    // a visa or sponsorship question with no matching saved answer is NEVER guessed from a loosely similar one
    if (fam === "visa" || fam === "sponsorship") return null;
  }
  // "years of experience with X": an answer saved for X serves every wording of the question, and never serves a question about another tool
  const skill = yearsSkill(label);
  if (skill) return answers.find((a) => a.answer.trim() && yearsSkill(a.question) === skill)?.answer ?? null;
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

export const CONFIRMATION = /thank\s*you\s*for\s*(applying|your\s*application)|thanks\s*for\s*applying|application\s*(has\s*been\s*|was\s*|is\s*)?(successfully\s*)?(submitted|received|sent|complete)|successfully\s*(applied|submitted)|we('|’|\s*ha)ve\s*received\s*your\s*application|you('|’)ve\s*(successfully\s*)?applied/i;

/** Things the worker must never try to work around. */
export type Block = "captcha" | "checkpoint" | "login" | null;
export function detectBlock(url: string, bodyText: string, hasCaptchaFrame: boolean): Block {
  if (/linkedin\.com\/(checkpoint|authwall|uas\/)/i.test(url) || /unusual\s*activity|security\s*verification|verify\s*it'?s\s*you|temporarily\s*restricted/i.test(bodyText)) return "checkpoint";
  if (hasCaptchaFrame) return "captcha";
  if (/\/(login|signin|sign-in)\b/i.test(url)) return "login";
  return null;
}

/** Does the browser hold a LinkedIn sign-in? LinkedIn sets the `li_at` cookie when you are signed in; without it a job page is the public, signed-out view with no Easy Apply. */
export function linkedinSignedIn(cookies: { name: string; domain: string; expires?: number }[], nowSec = Date.now() / 1000): boolean {
  return cookies.some((c) => c.name === "li_at" && /(^|\.)linkedin\.com$/i.test(c.domain.replace(/^\./, "")) && (!c.expires || c.expires < 0 || c.expires > nowSec));
}

/** A job board's "Access Denied" / "request could not be satisfied" page: the site refused this browser, so nothing on it can be read or clicked. */
export function boardDenied(title: string, bodyText: string): boolean {
  const t = (title || "").trim();
  if (/^(access denied|error: the request could not be satisfied|403 forbidden|request blocked|you have been blocked)/i.test(t)) return true;
  return /the request could not be satisfied|you don'?t have permission to access|access denied/i.test((bodyText || "").slice(0, 600)) && (bodyText || "").length < 1200;
}
