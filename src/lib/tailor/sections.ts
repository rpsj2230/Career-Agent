import type { MasterProfile, TailoredResume } from "@/lib/types";
import { STYLES, type ResumeStyle, type SectionId } from "./template";

/** The resume as plain structured text. The DOCX file and the on-screen preview are both built from this, so they cannot disagree. */
export type ResumeView = {
  name: string; headline: string; credentials: string; contact: string; summary: string;
  highlights: string[];
  caseStudies: string[];
  /** Core Competencies and Technical Skills, each filed under the headings from your master resume */
  competencies: SkillGroup[];
  technical: SkillGroup[];
  /** skills with no heading or kind: a plain list */
  skills: string[];
  experience: { title: string; company: string; dates: string; location: string | null; bullets: string[] }[];
  education: string[];
  certifications: string[];
  development: string[];
  awards: string[];
};
export type SkillGroup = { group: string; items: string[] };

/** Group the chosen skills under their headings, keeping the master's heading order and the chosen (job-relevant) item order. */
function groupSkills(skills: MasterProfile["skills"], kind: "competency" | "technical"): SkillGroup[] {
  const out: SkillGroup[] = [];
  for (const s of skills) {
    if (s.kind !== kind) continue;
    const g = s.group ?? "";
    (out.find((x) => x.group === g) ?? out[out.push({ group: g, items: [] }) - 1]).items.push(s.name);
  }
  return out;
}

/** Company, title and dates always come from the master profile, never from model output. */
export function resumeView(p: MasterProfile, t: TailoredResume, style?: ResumeStyle): ResumeView {
  const b = p.basics;
  const chosen = t.skillIds.flatMap((id) => { const k = p.skills.find((s) => s.id === id); return k ? [k] : []; });
  return {
    name: b.name,
    headline: t.headline || b.headline,
    credentials: b.credentials ?? "",
    contact: [b.email, b.phone, [b.location, b.workStatus].filter(Boolean).join(" - "), ...b.links].filter(Boolean).join("  |  "),
    summary: t.summary.text,
    highlights: (t.highlightIds ?? []).map((id) => p.highlights.find((h) => h.id === id)?.text).filter((x): x is string => !!x),
    caseStudies: p.caseStudies.map((c) => c.title),
    competencies: groupSkills(chosen, "competency"),
    technical: groupSkills(chosen, "technical"),
    skills: chosen.filter((s) => !s.kind).map((s) => s.name),
    experience: t.experience.flatMap((te) => {
      const e = p.experience.find((x) => x.id === te.experienceId);
      return e ? [{ title: e.title, company: e.company, dates: [e.start, e.end].filter(Boolean).join(" - "), location: e.location ?? null, bullets: te.bullets.slice(0, style?.maxBullets ?? 99).map((x) => x.text) }] : [];
    }),
    education: p.education.map((ed) => `${ed.degree}, ${ed.school}${ed.start || ed.end ? ` (${[ed.start, ed.end].filter(Boolean).join(" - ")})` : ""}`),
    certifications: t.certificationIds.map((id) => p.certifications.find((c) => c.id === id)?.name).filter((x): x is string => !!x),
    development: p.development.map((d) => d.name),
    awards: p.awards.map((a) => a.name),
  };
}

/** Your master profile laid out as a resume with nothing selected or reworded: the "original" the tailored copy started from. */
export function masterAsTailored(p: MasterProfile): TailoredResume {
  return {
    headline: p.basics.headline,
    summary: { text: p.basics.summary, sourceIds: ["summary"] },
    experience: p.experience.map((e) => ({ experienceId: e.id, bullets: e.bullets.map((x) => ({ text: x.text, sourceIds: [x.id] })) })),
    skillIds: p.skills.filter((s) => !s.extra).map((s) => s.id),
    certificationIds: p.certifications.map((c) => c.id),
    highlightIds: p.highlights.map((h) => h.id),
  };
}

/** "Job title, Company, Location": the order applicant-tracking parsers expect. */
export const experienceTitle = (e: { title: string; company: string; location: string | null }) => [e.title, e.company, e.location].filter(Boolean).join(", ");

/** Plain text of a resume, for the preview and for tests. Follows the same section order and labels as the DOCX. */
export function resumeText(v: ResumeView, style: ResumeStyle = STYLES[0]): string[] {
  const out: string[] = [v.name, ...(v.headline ? [v.headline] : []), ...(v.credentials ? [v.credentials] : []), v.contact];
  const grouped = (label: string, gs: SkillGroup[]) => (gs.length ? [label.toUpperCase(), ...gs.map((g) => (g.group ? `${g.group}: ` : "") + g.items.join(", "))] : []);
  const blocks: Record<SectionId, () => string[]> = {
    summary: () => (v.summary ? [style.summaryLabel.toUpperCase(), v.summary] : []),
    highlights: () => (v.highlights.length ? ["CAREER HIGHLIGHTS", ...v.highlights] : []),
    caseStudies: () => (v.caseStudies.length ? ["CASE STUDIES", ...v.caseStudies] : []),
    competencies: () => grouped("Core Competencies", v.competencies),
    technical: () => grouped("Technical Skills", v.technical),
    development: () => (v.development.length ? ["PROFESSIONAL DEVELOPMENT", ...v.development] : []),
    awards: () => (v.awards.length ? ["AWARDS AND RECOGNITION", ...v.awards] : []),
    skills: () => (v.skills.length ? ["SKILLS", v.skills.join(", ")] : []),
    experience: () => ["WORK EXPERIENCE", ...v.experience.flatMap((e) => [`${experienceTitle(e)}\t${e.dates}`, ...e.bullets])],
    education: () => (v.education.length ? ["EDUCATION", ...v.education] : []),
    certifications: () => (v.certifications.length ? ["CERTIFICATIONS", ...v.certifications] : []),
  };
  return [...out, ...style.sections.flatMap((s) => blocks[s]())];
}
