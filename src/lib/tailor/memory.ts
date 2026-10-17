import type { MasterProfile, TailoredResume } from "@/lib/types";
import { cosine, jaccard, jobTokens, titleFamily, tfidf, tokenize, topTerms, type JobLike } from "./similarity";

/** A resume the agent made before, with what it was made for and how that application went. */
export type PastResume = {
  jobId: string; title: string; company: string; description: string; country: string | null;
  content: TailoredResume; lifecycle: string; createdAt: string;
  /** the cover letter that went with it, when there was one */
  cover?: { text: string; sourceIds: string[] } | null;
};

export type Thresholds = { reuse: number; adapt: number };
export const DEFAULT_THRESHOLDS: Thresholds = { reuse: 0.85, adapt: 0.4 };

export type Library = { past: PastResume[]; enabled?: boolean; thresholds?: Thresholds };

/** Applications that led somewhere are better starting points than ones that did not. */
const QUALITY: Record<string, number> = { offer: 1.15, interview: 1.1, applied: 1.02, none: 1, withdrawn: 0.97, rejected: 0.9 };

export type Candidate = { past: PastResume; similarity: number; titleOverlap: number; score: number };

/**
 * Past resumes ranked by how close their job was to this one: TF-IDF cosine of the descriptions (title counted heavily),
 * nudged by whether the old application got a response. Entirely local.
 */
export function rankPast(job: JobLike, past: PastResume[]): Candidate[] {
  if (past.length === 0) return [];
  const docs = [jobTokens(job), ...past.map((p) => jobTokens(p))];
  const vecs = tfidf(docs);
  const mine = titleFamily(job.title);
  return past
    .map((p, i) => {
      const similarity = cosine(vecs[0], vecs[i + 1]);
      return { past: p, similarity, titleOverlap: jaccard(mine, titleFamily(p.title)), score: similarity * (QUALITY[p.lifecycle] ?? 1) };
    })
    .sort((a, b) => b.score - a.score);
}

export type ReuseDecision =
  | { mode: "reuse"; from: Candidate; gaps: string[] }
  | { mode: "adapt"; from: Candidate; gaps: string[] }
  | { mode: "fresh"; from: null; gaps: string[] };

const resumeWords = (r: TailoredResume, profile: MasterProfile): Set<string> => {
  const text = [r.headline, r.summary.text, ...r.experience.flatMap((e) => e.bullets.map((b) => b.text)), ...r.skillIds.map((id) => profile.skills.find((s) => s.id === id)?.name ?? "")].join(" ");
  return new Set(tokenize(text));
};

/** Words the new job stresses that the candidate's profile really supports but the base resume never mentions. */
export function emphasisGaps(job: JobLike, others: PastResume[], base: TailoredResume, profile: MasterProfile, profileWords: Set<string>): string[] {
  const vecs = tfidf([jobTokens(job), ...others.map((p) => jobTokens(p))]);
  const have = resumeWords(base, profile);
  return topTerms(vecs[0], 25).filter((w) => profileWords.has(w) && !have.has(w));
}

/**
 * Decide how to build the resume:
 *  - reuse: the job is nearly the same role as one done before AND the old resume already mentions everything this job
 *    stresses that the candidate can truthfully support. No model call.
 *  - adapt: a similar job exists; the model only edits what this job needs, starting from the approved resume.
 *  - fresh: nothing close enough; generate from the profile.
 */
export function decideReuse(job: JobLike, past: PastResume[], profile: MasterProfile, profileWords: Set<string>, t: Thresholds = DEFAULT_THRESHOLDS): ReuseDecision {
  const ranked = rankPast(job, past);
  const best = ranked[0];
  if (!best || best.similarity < t.adapt || best.titleOverlap === 0) return { mode: "fresh", from: null, gaps: [] };
  const gaps = emphasisGaps(job, past, best.past.content, profile, profileWords);
  const sameRole = best.titleOverlap >= 0.6;
  if (best.similarity >= t.reuse && sameRole && gaps.length <= 1) return { mode: "reuse", from: best, gaps };
  return { mode: "adapt", from: best, gaps };
}

/** Provenance recorded on the new document so the page can say where it came from and what it saved. */
export type Provenance = {
  mode: "fresh" | "reused" | "adapted";
  from?: { jobId: string; title: string; company: string; similarity: number };
  modelCalls: number;
  /** rough size of the model work avoided, from the prompt that would have been sent (characters / 4 + a typical answer) */
  tokensSavedEstimate: number;
};

export const estimateTokens = (chars: number) => Math.round(chars / 4);

/** The resume as the model sees it when asked to adapt it (ids kept so the checker can trace every claim). */
export const baseResumeBlock = (r: TailoredResume) => JSON.stringify(r);

/**
 * Cover letters are about one company. A letter is only carried over when the jobs are near-identical, with the company
 * and role names switched; the checker still has to pass it.
 */
export function carryCoverLetter(text: string, from: { company: string; title: string }, to: { company: string; title: string }): string {
  const swap = (s: string, a: string, b: string) => (a.trim() ? s.split(a).join(b) : s);
  return swap(swap(text, from.company, to.company), from.title, to.title);
}

export type ResumePatch = {
  headline?: string;
  summary?: { text: string; sourceIds: string[] };
  experience?: { experienceId: string; bullets: { text: string; sourceIds: string[] }[] }[];
  skillIds?: string[];
  certificationIds?: string[];
};

/** Apply the model's edits on top of the approved resume: only what the patch names changes. */
export function applyPatch(base: TailoredResume, patch: ResumePatch): TailoredResume {
  const byId = new Map((patch.experience ?? []).filter((e) => e.bullets.length > 0).map((e) => [e.experienceId, e.bullets]));
  const merged = base.experience.map((e) => (byId.has(e.experienceId) ? { ...e, bullets: byId.get(e.experienceId)! } : e));
  for (const [id, bullets] of byId) if (!merged.some((e) => e.experienceId === id)) merged.push({ experienceId: id, bullets });
  return {
    headline: patch.headline?.trim() ? patch.headline : base.headline,
    summary: patch.summary?.text?.trim() ? patch.summary : base.summary,
    experience: merged,
    skillIds: patch.skillIds && patch.skillIds.length > 0 ? patch.skillIds : base.skillIds,
    certificationIds: patch.certificationIds ?? base.certificationIds,
  };
}
