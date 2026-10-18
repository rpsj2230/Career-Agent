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

const initialism = (name: string) => name.split(/[\s/&-]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();

/**
 * Skill labels in the job's own wording. A label is kept only when it appears in the job text AND clearly names the same skill
 * (it shares a word with the skill, or one is the initials of the other), so a rephrased skill can never become a different one.
 */
export function safeSkillLabels(p: MasterProfile, ids: string[], labels: Record<string, string> | undefined, job: { title: string; description: string }): Record<string, string> | undefined {
  if (!labels) return undefined;
  const jobText = ` ${tokenize(`${job.title} ${job.description}`).join(" ")} `;
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(labels)) {
    const label = raw.trim().replace(/\s+/g, " ");
    const skill = p.skills.find((s) => s.id === id);
    if (!skill || !ids.includes(id) || !label || label.length > 60 || label.toLowerCase() === skill.name.toLowerCase()) continue;
    const lt = tokenize(label), st = tokenize(skill.name);
    if (lt.length === 0 || !jobText.includes(` ${lt.join(" ")} `)) continue;
    const related = lt.some((w) => st.includes(w)) || initialism(label) === skill.name.toLowerCase().replace(/[^a-z0-9]/g, "") || initialism(skill.name) === label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (related) out[id] = label;
  }
  return Object.keys(out).length ? out : undefined;
}

export function withBalancedSkills(p: MasterProfile, t: TailoredResume, job: { title: string; description: string }): TailoredResume {
  const skillIds = balanceSkills(p, t.skillIds, job);
  const skillLabels = safeSkillLabels(p, skillIds, t.skillLabels, job);
  const { skillLabels: _drop, ...rest } = t;
  void _drop;
  return { ...rest, skillIds, ...(skillLabels ? { skillLabels } : {}) };
}
