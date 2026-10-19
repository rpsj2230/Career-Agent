import type { MasterProfile } from "@/lib/types";

export type SkillSection = "competency" | "technical" | "other";
export const SECTION_LABEL: Record<SkillSection, string> = { competency: "Core Competencies", technical: "Technical Skills", other: "Other skills" };

export const skillSection = (s: MasterProfile["skills"][number]): SkillSection => s.kind ?? "other";

/** A new id that cannot collide with an existing one, even after skills were removed. */
export function nextSkillId(skills: { id: string }[]): string {
  const used = new Set(skills.map((s) => s.id));
  let n = skills.reduce((m, s) => Math.max(m, Number(/^skill(\d+)$/.exec(s.id)?.[1] ?? 0)), 0) + 1;
  while (used.has(`skill${n}`)) n++;
  return `skill${n}`;
}

/** Ids must be unique across every list, because the tailoring step and the verifier refer to facts by id. Returns the first clash. */
export function duplicateId(p: MasterProfile): string | null {
  const seen = new Set<string>();
  const ids = [
    ...p.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...p.education.map((e) => e.id), ...p.skills.map((s) => s.id), ...p.certifications.map((c) => c.id),
    ...p.highlights.map((h) => h.id), ...p.caseStudies.map((c) => c.id), ...p.development.map((d) => d.id), ...p.awards.map((a) => a.id),
    ...(p.sections ?? []).flatMap((x) => [x.id, ...x.bullets.map((b) => b.id)]),
  ];
  for (const id of ids) { if (seen.has(id)) return id; seen.add(id); }
  return null;
}

/** An import replaces the profile, but skills you added by hand must survive it: any current skill the new profile lacks (by name) is carried over. */
export function keepCurrentSkills(next: MasterProfile, current: MasterProfile): { profile: MasterProfile; kept: number } {
  const norm = (s: string) => s.trim().toLowerCase();
  const have = new Set(next.skills.map((s) => norm(s.name)));
  const skills = [...next.skills];
  let kept = 0;
  for (const s of current.skills) {
    if (!s.name.trim() || have.has(norm(s.name))) continue;
    have.add(norm(s.name));
    skills.push({ ...s, id: nextSkillId(skills) });
    kept++;
  }
  return { profile: { ...next, skills }, kept };
}
