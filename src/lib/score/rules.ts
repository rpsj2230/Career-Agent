import { vocabulary } from "@/lib/docs/verify";
import { tokenize, titleFamily } from "@/lib/tailor/similarity";
import type { JobScore, MasterProfile } from "@/lib/types";
import type { JobForScoring } from "./prompt";

/**
 * Evidence about a job that is computed from the profile and the posting alone, with no model. It does three things:
 *  1. rejects the clearly irrelevant job before any model quota is spent (thousands of scanned jobs are mostly noise),
 *  2. is shown to the model as facts, so the model judges rather than guesses,
 *  3. bounds the model's score, so a sloppy or over-generous model (or a weaker fallback model) cannot send a poor match
 *     to your queue, or bury a strong one.
 */
export type Evidence = {
  /** 0-100, a rough but stable estimate */
  score: number;
  titleMatch: number; // share of the job title's role words the candidate's history/profile uses (0-1)
  skillCoverage: number; // share of the posting's most frequent terms the profile covers (0-1)
  sharedTerms: string[]; // posting terms the profile covers, most frequent first
  missingTerms: string[]; // frequent posting terms the profile does not mention
  requiredYears: number | null;
  candidateYears: number | null;
  seniorityGap: number; // years the posting asks beyond the candidate's experience (0 when fine)
  thinPosting: boolean; // too little text for the skill figures to mean much
};

const YEARS = /(\d{1,2})\s*(?:\+|plus)?(?:\s*(?:-|to|–)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:'s)?(?:\s+of)?(?:\s+(?:relevant|professional|hands-on|work|industry|product|related))*\s*(?:experience|exp)?/gi;

/** Years the posting asks for: the largest plausible "N years" figure near the word experience. */
export function requiredYears(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(YEARS)) {
    const n = Number(m[2] ?? m[1]);
    const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).toLowerCase();
    if (n >= 1 && n <= 30 && /experience|exp\b|background|track record|in a similar|in product|in a/.test(ctx)) best = Math.max(best ?? 0, n);
  }
  return best;
}

const yearOf = (s: string | null | undefined, fallback: number): number | null => {
  if (!s) return null;
  if (/present|current|now|ongoing/i.test(s)) return fallback;
  const m = s.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

/** Total years of experience from the date ranges (overlaps counted once). Null when the dates cannot be read. */
export function candidateYears(p: MasterProfile, now = new Date()): number | null {
  const thisYear = now.getUTCFullYear();
  const spans = p.experience
    .map((e) => [yearOf(e.start, thisYear), yearOf(e.end, thisYear) ?? thisYear] as const)
    .filter((s): s is readonly [number, number] => s[0] !== null && s[1] >= s[0])
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let total = 0, [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) { if (s <= ce) ce = Math.max(ce, e); else { total += ce - cs; cs = s; ce = e; } }
  return total + (ce - cs);
}

const stemmedVocab = (p: MasterProfile) => new Set(tokenize([...vocabulary(p)].join(" ")));

export function gatherEvidence(p: MasterProfile, job: JobForScoring, now = new Date()): Evidence {
  const vocab = stemmedVocab(p);
  const roleWords = new Set([...p.experience.map((e) => e.title), ...p.preferences.roles, p.basics.headline].flatMap((t) => titleFamily(t)));
  const fam = titleFamily(job.title);
  const titleMatch = fam.length ? fam.filter((w) => vocab.has(w) || roleWords.has(w)).length / fam.length : 0;

  const counts = new Map<string, number>();
  for (const w of tokenize(job.description)) if (w.length > 2 && !/^\d/.test(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40).map(([w]) => w);
  const sharedTerms = top.filter((w) => vocab.has(w));
  const missingTerms = top.filter((w) => !vocab.has(w)).slice(0, 12);
  const skillCoverage = top.length ? sharedTerms.length / top.length : 0;
  const thinPosting = job.description.trim().length < 400 || top.length < 15;

  const req = requiredYears(job.description);
  const have = candidateYears(p, now);
  const seniorityGap = req !== null && have !== null ? Math.max(0, req - have) : 0;

  const seniority = seniorityGap === 0 ? 1 : Math.max(0, 1 - seniorityGap / 6);
  const skillPart = thinPosting ? Math.max(skillCoverage, 0.5) : Math.min(1, skillCoverage / 0.55); // 55% term coverage counts as full marks
  const score = Math.round(100 * (0.4 * titleMatch + 0.45 * skillPart + 0.15 * seniority));
  return { score, titleMatch, skillCoverage, sharedTerms: sharedTerms.slice(0, 12), missingTerms, requiredYears: req, candidateYears: have, seniorityGap, thinPosting };
}

/** Obviously irrelevant: no role word in common AND almost no shared vocabulary, on a posting long enough to judge. Null when it should go on to the model. */
export function irrelevantReason(e: Evidence): string | null {
  if (e.thinPosting) return null;
  if (e.titleMatch === 0 && e.skillCoverage < 0.12) return `No overlap with your profile: none of the role words in the title and only ${Math.round(e.skillCoverage * 100)}% of the posting's key terms appear in your experience`;
  return null;
}

/** How far the model's number may sit from the rule-based evidence before it is pulled back. */
const BAND = 35;

export type Judged = { score: number; output: JobScore; notes: string[]; adjusted: boolean };

/**
 * Check the model's answer against the evidence. Skills the model says match but that the profile never mentions are removed
 * (the model may not credit the candidate with skills that are not on file); the score is then kept within BAND points of the
 * evidence, tighter when the model leaned on skills that were not real.
 */
export function judge(model: JobScore, e: Evidence, p: MasterProfile): Judged {
  const vocab = stemmedVocab(p);
  const real: string[] = [], unreal: string[] = [];
  for (const s of model.matchedSkills) {
    const toks = tokenize(s);
    (toks.length === 0 || toks.some((t) => vocab.has(t)) ? real : unreal).push(s);
  }
  const notes: string[] = [];
  if (unreal.length) notes.push(`Ignored skills the model credited that are not in your profile: ${unreal.join(", ")}`);
  const band = unreal.length > 0 && unreal.length >= real.length ? 20 : BAND;
  const lo = Math.max(0, e.score - band), hi = Math.min(100, e.score + band);
  let score = Math.round(model.score);
  if (score > hi) { notes.push(`Model said ${score} but the evidence supports about ${e.score}: lowered to ${hi}`); score = hi; }
  else if (score < lo) { notes.push(`Model said ${score} but the evidence supports about ${e.score}: raised to ${lo}`); score = lo; }
  if (e.seniorityGap >= 3 && score > 70) { notes.push(`The posting asks for ${e.requiredYears} years and you have about ${e.candidateYears}: capped at 70`); score = 70; }
  return { score, output: { ...model, score, matchedSkills: real }, notes, adjusted: notes.length > 0 };
}

export function evidenceText(e: Evidence): string {
  const lines = [
    `Role words in the job title that the candidate's history uses: ${Math.round(e.titleMatch * 100)}%`,
    e.thinPosting ? "The posting is short: skill overlap cannot be judged reliably." : `Key terms of the posting found in the candidate's profile: ${e.sharedTerms.join(", ") || "none"}`,
    !e.thinPosting && e.missingTerms.length ? `Key terms of the posting NOT found in the candidate's profile: ${e.missingTerms.join(", ")}` : "",
    e.requiredYears !== null ? `Experience asked: ${e.requiredYears} years; candidate has about ${e.candidateYears ?? "an unknown number of"} years.` : "",
    `Rule-based estimate: ${e.score}/100 (a guide, not the answer)`,
  ];
  return lines.filter(Boolean).join("\n");
}
