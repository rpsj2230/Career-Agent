import type { MasterProfile } from "@/lib/types";

const JOB_FIELDS = [
  "id", "title", "company", "country", "location", "url", "description", "source", "portal", "apply_type", "external_id",
  "salary_text", "salary_min", "salary_max", "salary_currency", "salary_estimated", "posted_at", "found_at", "status", "skip_reason", "decided_at",
] as const;

export type JobSnapshot = Record<(typeof JOB_FIELDS)[number], unknown> & {
  fit: { score: number; model: string | null; summary: string | null; matchedSkills: string[]; gaps: string[] } | null;
  captured_at: string;
};

/**
 * A frozen copy of the posting as it was when the application was prepared. Job listings are edited or removed by
 * employers, and re-scans can update our own row, so the application keeps its own record of what it was for.
 */
export function buildJobSnapshot(job: Record<string, unknown>, score: { score: number; model?: string | null; detail?: { summary?: string; matchedSkills?: string[]; gaps?: string[] } } | null, now = new Date()): JobSnapshot {
  const out: Record<string, unknown> = {};
  for (const k of JOB_FIELDS) out[k] = job[k] ?? null;
  out.fit = score ? { score: score.score, model: score.model ?? null, summary: score.detail?.summary ?? null, matchedSkills: score.detail?.matchedSkills ?? [], gaps: score.detail?.gaps ?? [] } : null;
  out.captured_at = now.toISOString();
  return out as JobSnapshot;
}

export type ProfileSnapshot = { captured_at: string; profile: MasterProfile };

/** Your master profile exactly as it was when the application was prepared; later profile edits never touch it. */
export const buildProfileSnapshot = (profile: MasterProfile, now = new Date()): ProfileSnapshot => ({ captured_at: now.toISOString(), profile: JSON.parse(JSON.stringify(profile)) as MasterProfile });
