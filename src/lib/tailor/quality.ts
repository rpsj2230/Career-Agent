import type { MasterProfile, TailoredResume } from "@/lib/types";
import { vocabulary } from "@/lib/docs/verify";
import { tokenize, titleFamily } from "./similarity";

/**
 * How well a tailored resume is aimed at its job, measured locally (no model tokens). It answers three questions:
 *  - does it use the job's own words wherever the candidate's profile honestly supports them (keyword coverage)?
 *  - was it actually written for this job, or is it the master resume with a few lines moved (headline, summary, rewritten bullets)?
 *  - what specifically should be improved? (`problems` is fed back to the model for one more attempt)
 */
export type Quality = {
  /** 0-100: share of the job's key terms that the candidate supports AND the resume uses */
  keywordCoverage: number;
  covered: string[];
  /** supported by the profile, asked for by the job, but missing from the resume */
  missing: string[];
  /** asked for by the job but not in the profile: never added, shown so you know the real gaps */
  gaps: string[];
  bulletsRewritten: number;
  bulletsTotal: number;
  headlineTailored: boolean;
  summaryTailored: boolean;
  score: number;
  problems: string[];
};

const GENERIC = new Set("manage management ability communication responsible lead leading business develop development support provide ensure strong drive driving help multiple various high level based key range part full time ownership".split(" "));

/** The job's key terms: the title's words and the description's most repeated words, strongest first. */
export function jobKeyTerms(job: { title: string; description: string }, n = 24): string[] {
  const counts = new Map<string, number>();
  for (const w of tokenize(job.title)) counts.set(w, (counts.get(w) ?? 0) + 4);
  for (const w of tokenize(job.description.slice(0, 8000))) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([w]) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function assessTailoring(p: MasterProfile, t: TailoredResume, job: { title: string; description: string }): Quality {
  const terms = jobKeyTerms(job);
  const profileWords = new Set(tokenize([...vocabulary(p)].join(" ")));
  const supported = terms.filter((w) => profileWords.has(w));
  const gaps = terms.filter((w) => !profileWords.has(w));
  const chosenSkills = t.skillIds.flatMap((id) => p.skills.find((s) => s.id === id)?.name ?? []);
  const highlights = (t.highlightIds ?? []).flatMap((id) => p.highlights.find((h) => h.id === id)?.text ?? []);
  const bullets = t.experience.flatMap((e) => e.bullets.map((b) => b.text));
  const have = new Set(tokenize([t.headline, t.summary.text, ...bullets, ...chosenSkills, ...highlights].join(" ")));
  const covered = supported.filter((w) => have.has(w));
  const missing = supported.filter((w) => !have.has(w));
  const keywordCoverage = supported.length ? Math.round((covered.length / supported.length) * 100) : 100;

  const masterBullets = new Set(p.experience.flatMap((e) => e.bullets.map((b) => norm(b.text))));
  const bulletsRewritten = bullets.filter((b) => !masterBullets.has(norm(b))).length;
  const jobTitle = new Set(titleFamily(job.title));
  const headlineTailored = !!t.headline && norm(t.headline) !== norm(p.basics.headline) && tokenize(t.headline).some((w) => jobTitle.has(w));
  const summaryTermHits = tokenize(t.summary.text).filter((w) => supported.includes(w));
  const summaryTailored = norm(t.summary.text) !== norm(p.basics.summary) && new Set(summaryTermHits).size >= 2;

  const problems: string[] = [];
  if (!headlineTailored) problems.push(`The headline should name the role this job hires for ("${job.title}") using only titles and areas the candidate has really held (no seniority word they have not held), instead of repeating the master headline.`);
  if (!summaryTailored) problems.push("The summary is the master summary or does not use this job's own key terms. Rewrite it in 3-4 sentences around what THIS job asks for first, with one quantified achievement from the facts.");
  if (bullets.length > 0 && bulletsRewritten / bullets.length < 0.5) problems.push(`Only ${bulletsRewritten} of ${bullets.length} bullets are reworded for this job. Reword each chosen bullet: start with a strong action verb, put what this job values first, name the same tools/methods the job names when the cited fact says the candidate used them, and end with the result and its exact figure.`);
  if (keywordCoverage < 70 && missing.length) problems.push(`These job terms are supported by the candidate's facts but missing from the resume; work them into the headline, summary, bullets or skills where a cited fact supports them: ${missing.slice(0, 12).join(", ")}.`);

  const score = Math.round(
    keywordCoverage * 0.4 + (headlineTailored ? 15 : 0) + (summaryTailored ? 15 : 0) + (bullets.length ? Math.min(1, bulletsRewritten / Math.max(1, bullets.length * 0.7)) * 30 : 0),
  );
  return { keywordCoverage, covered, missing, gaps, bulletsRewritten, bulletsTotal: bullets.length, headlineTailored, summaryTailored, score, problems };
}

export const GOOD_ENOUGH = 75;
