/** Pure helpers for the apply worker: no browser, no network, fully unit-tested. */
import { yearsSkill } from "../src/lib/apply/skill-years";
import { languageAsked } from "../src/lib/apply/languages";

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

/**
 * Words that carry a question's meaning, with the many ways of saying the same thing folded together, so a rephrased question finds the answer saved for another wording:
 * "Are you legally entitled to work in Singapore?" and "Do you have the right to work in Singapore?" both become {authorised, work, singapore}. Filler words are dropped.
 */
const FILLER = new Set(["select", "choose", "check", "tick", "mark", "all", "apply", "applies", "multiple", "one", "more", "these", "those", "following", "below", "above", "listed", "to", "in", "of", "on", "at", "or", "be", "an", "as", "by", "if", "so", "we", "my", "me", "it", "up", "no", "do", "does", "did", "are", "is", "was", "were", "have", "has", "had", "you", "your", "yours", "the", "and", "for", "any", "with", "that", "this", "please", "kindly", "currently", "now", "would", "could", "can", "will", "shall", "what", "which", "how", "many", "much", "when", "where", "about", "from", "into", "our", "their", "from", "been", "being", "who", "whom", "also", "just", "able", "like", "yes", "per", "required", "require", "requires", "mandatory", "optional"]);
const CANON: [RegExp, string][] = [
  [/^(legally|lawfully|entitled|eligible|permitted|allowed|authori[sz]ed|authori[sz]ation|authori[sz]ing|right|rights)$/, "authorised"],
  [/^(employment|employed|work|working|job|role|position)$/, "work"],
  [/^(salary|ctc|compensation|remuneration|pay|package|wage|wages)$/, "salary"],
  [/^(expect|expected|expectation|expectations|desired|desire|target|ideal)$/, "expected"],
  [/^(relocate|relocation|relocating|move|moving|reloc)$/, "relocate"],
  [/^(notice|joining|join|start|starting|available|availability|availabilty|earliest)$/, "start"],
  [/^(years|year|yrs|yr|experience|experienced|exp)$/, "experience"],
  [/^(bachelor|bachelors|degree|degrees|graduate|graduation|undergraduate|diploma|qualification|qualified|education|educational)$/, "degree"],
  [/^(comfortable|willing|open|okay|ok|fine|prepared|agree)$/, "willing"],
  [/^(commute|commuting|onsite|office|inperson|premises)$/, "onsite"],
  [/^(remote|remotely|wfh|home|telework)$/, "remote"],
  [/^(sponsor|sponsors|sponsored|sponsorship|sponsoring)$/, "sponsor"],
  [/^(visa|visas|permit|permits|passport)$/, "visa"],
  [/^(english|fluent|fluency|proficient|proficiency|speak|spoken|written|communicate)$/, "language"],
  [/^(background|screening|verification|check|checks)$/, "background"],
];
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
export function meaning(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)) {
    if (raw.length < 2 || FILLER.has(raw)) continue;
    const hit = CANON.find(([re]) => re.test(raw) || re.test(stem(raw)));
    out.add(hit ? hit[1] : stem(raw));
  }
  return out;
}

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
  // a saved answer about one language never answers a question about another ("level in English" is not "level in Chinese")
  const lang = languageAsked(label);
  if (lang) return answers.find((a) => a.answer.trim() && languageAsked(a.question) === lang)?.answer ?? null;
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
  if (best && best.score >= 0.5) return best.answer;
  // a rephrased question: the same meaning words, with most of the shorter question inside the longer one
  const lm = meaning(label);
  if (lm.size < 1) return null;
  let near: { score: number; answer: string } | null = null;
  for (const a of answers) {
    if (!a.answer.trim() || family(a.question) || languageAsked(a.question) || yearsSkill(a.question)) continue;
    const am = meaning(a.question);
    const inter = [...lm].filter((w) => am.has(w)).length;
    const score = inter / Math.min(lm.size, am.size);
    const jac = inter / (lm.size + am.size - inter);
    // two or more shared meaning words with most of the shorter question inside the longer one, or exactly the same single meaning word ("start", "degree")
    if (((inter >= 2 && score >= 0.8 && jac >= 0.5) || (inter === 1 && lm.size === 1 && am.size === 1)) && (!near || jac > near.score)) near = { score: jac, answer: a.answer };
  }
  return near ? near.answer : null;
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
