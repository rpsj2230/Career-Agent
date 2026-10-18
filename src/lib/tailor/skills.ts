import type { MasterProfile, TailoredResume } from "@/lib/types";
import { tokenize } from "./similarity";

/** The share of your master-resume skills that always stay on a tailored resume, so it never looks thin. */
export const MIN_SKILL_SHARE = 0.75;

/**
 * Order the skills for one job and make sure enough of them stay.
 * Skills the job description mentions go first (their own wording decides, nothing is invented), then the ones the model picked,
 * then everything else from the master resume. At least MIN_SKILL_SHARE of the master's skills are kept, and never fewer than the model chose.
 */
export function balanceSkills(p: MasterProfile, chosenIds: string[], job: { title: string; description: string }): string[] {
  const master = p.skills.filter((s) => !s.extra);
  const known = new Set(p.skills.map((s) => s.id));
  const jobWords = new Set(tokenize(`${job.title} ${job.description}`));
  const jobText = ` ${tokenize(`${job.title} ${job.description}`).join(" ")} `;
  const mentioned = (name: string) => {
    const t = tokenize(name);
    return t.length > 0 && (jobText.includes(` ${t.join(" ")} `) || t.every((w) => jobWords.has(w)));
  };
  const picked = chosenIds.filter((id) => known.has(id));
  const out: string[] = [];
  const add = (id: string) => { if (!out.includes(id)) out.push(id); };
  for (const s of master) if (mentioned(s.name)) add(s.id);
  for (const id of picked) add(id);
  for (const s of master) add(s.id);
  const keep = Math.min(out.length, Math.max(picked.length, Math.ceil(master.length * MIN_SKILL_SHARE)));
  return out.slice(0, keep);
}

export const withBalancedSkills = (p: MasterProfile, t: TailoredResume, job: { title: string; description: string }): TailoredResume => ({ ...t, skillIds: balanceSkills(p, t.skillIds, job) });
