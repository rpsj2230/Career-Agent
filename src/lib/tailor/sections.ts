import type { MasterProfile, TailoredResume } from "@/lib/types";
import { STYLES, type ResumeStyle, type SectionId } from "./template";

/** The resume as plain structured text. The DOCX file and the on-screen preview are both built from this, so they cannot disagree. */
export type ResumeView = {
  name: string; headline: string; credentials: string; contact: string; summary: string;
  /** the line under the name, and the strip of key figures under the header: both printed exactly as in your profile */
  tagline: string;
  metrics: string[];
  highlights: string[];
  /** extra headed sections (for example "Company Brain"), printed exactly as in your profile */
  extras: { title: string; intro: string; flow: string; bullets: { label: string; text: string }[] }[];
  caseStudies: { title: string; url: string | null }[];
  /** Core Competencies and Technical Skills, each filed under the headings from your master resume */
  competencies: SkillGroup[];
  technical: SkillGroup[];
  /** skills with no heading or kind: a plain list */
  skills: string[];
  experience: ExperienceView[];
  education: { degree: string; school: string; dates: string }[];
  certifications: string[];
  development: string[];
  awards: string[];
};
export type SkillGroup = { group: string; items: string[] };
/**
 * One role. The first role of an employer carries `employer` (name, place and the dates of the whole stay), so an employer with
 * several roles is printed once with each role under it, as on the master resume.
 */
export type ExperienceView = {
  title: string; company: string; dates: string; location: string | null; bullets: string[];
  employer?: { name: string; location: string | null; dates: string; roles: number };
};

const DASH = " – ";
const span = (start?: string, end?: string) => [start, end].filter(Boolean).join(DASH);

/** Group the chosen skills under their headings, keeping the master's heading order and the chosen (job-relevant) item order. */
function groupSkills(skills: MasterProfile["skills"], kind: "competency" | "technical", labels?: Record<string, string>): SkillGroup[] {
  const out: SkillGroup[] = [];
  for (const s of skills) {
    if (s.kind !== kind) continue;
    const g = s.group ?? "";
    (out.find((x) => x.group === g) ?? out[out.push({ group: g, items: [] }) - 1]).items.push(labels?.[s.id] ?? s.name);
  }
  return out;
}

type Role = { title: string; company: string; dates: string; start?: string; end?: string; location: string | null; bullets: string[] };

/** Roles in a row at the same employer become one employer block: the stay runs from the oldest start to the newest end. */
export function groupEmployers(roles: Role[]): ExperienceView[] {
  const out: ExperienceView[] = [];
  for (let i = 0; i < roles.length;) {
    let j = i + 1;
    while (j < roles.length && roles[j].company.trim().toLowerCase() === roles[i].company.trim().toLowerCase()) j++;
    const group = roles.slice(i, j);
    // roles are newest first: the stay starts when the last one started and ends when the first one ended
    const stay = span(group[group.length - 1].start, group[0].end);
    group.forEach((r, k) => out.push({
      title: r.title, company: r.company, location: r.location, bullets: r.bullets,
      // with several roles each keeps its own dates; with one, the dates sit on the employer line
      dates: group.length > 1 ? r.dates : "",
      ...(k === 0 ? { employer: { name: r.company, location: r.location, dates: group.length > 1 ? stay : r.dates, roles: group.length } } : {}),
    }));
    i = j;
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
    tagline: b.tagline ?? "",
    metrics: (b.metrics ?? []).filter((m) => m.trim()),
    extras: (p.sections ?? []).map((x) => ({ title: x.title, intro: x.intro ?? "", flow: x.flow ?? "", bullets: x.bullets.map((y) => ({ label: y.label ?? "", text: y.text })) })),
    highlights: (t.highlightIds ?? []).map((id) => p.highlights.find((h) => h.id === id)?.text).filter((x): x is string => !!x),
    caseStudies: (t.caseStudyIds?.length ? t.caseStudyIds.flatMap((id) => p.caseStudies.find((c) => c.id === id) ?? []) : p.caseStudies).map((c) => ({ title: c.title, url: c.url?.trim() || null })),
    competencies: groupSkills(chosen, "competency", t.skillLabels),
    technical: groupSkills(chosen, "technical", t.skillLabels),
    skills: chosen.filter((s) => !s.kind).map((s) => t.skillLabels?.[s.id] ?? s.name),
    experience: groupEmployers(t.experience.flatMap((te) => {
      const e = p.experience.find((x) => x.id === te.experienceId);
      return e ? [{ title: e.title, company: e.company, dates: span(e.start, e.end), start: e.start, end: e.end, location: e.location ?? null, bullets: te.bullets.slice(0, style?.maxBullets ?? 99).map((x) => x.text) }] : [];
    })),
    education: p.education.map((ed) => ({ degree: ed.degree, school: ed.school, dates: span(ed.start, ed.end) })),
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
  const out: string[] = [v.name, ...(v.tagline ? [v.tagline] : []), ...(v.headline && v.headline !== v.tagline ? [v.headline] : []), ...(v.credentials ? [v.credentials] : []), v.contact, ...(v.metrics.length ? [v.metrics.join("  |  ")] : [])];
  const grouped = (label: string, gs: SkillGroup[]) => (gs.length ? [label.toUpperCase(), ...gs.map((g) => (g.group ? `${g.group}: ` : "") + g.items.join(", "))] : []);
  const blocks: Record<SectionId, () => string[]> = {
    summary: () => (v.summary ? [style.summaryLabel.toUpperCase(), v.summary] : []),
    highlights: () => (v.highlights.length ? ["CAREER HIGHLIGHTS", ...v.highlights] : []),
    extras: () => v.extras.flatMap((x) => [x.title.toUpperCase(), ...(x.intro ? [x.intro] : []), ...(x.flow ? [x.flow] : []), ...x.bullets.map((b) => (b.label ? `${b.label}: ` : "") + b.text)]),
    caseStudies: () => (v.caseStudies.length ? ["CASE STUDIES", ...v.caseStudies.map((c) => (c.url ? `${c.title}: Click Here To View (${c.url})` : c.title))] : []),
    competencies: () => grouped("Core Competencies", v.competencies),
    technical: () => grouped("Technical Skills", v.technical),
    development: () => (v.development.length ? ["PROFESSIONAL DEVELOPMENT", ...v.development] : []),
    awards: () => (v.awards.length ? ["AWARDS AND RECOGNITION", ...v.awards] : []),
    skills: () => (v.skills.length ? ["SKILLS", v.skills.join(", ")] : []),
    experience: () => ["PROFESSIONAL EXPERIENCE", ...v.experience.flatMap((e) => [
      ...(e.employer ? [`${[e.employer.name, e.employer.location].filter(Boolean).join(", ")}${e.employer.dates ? `\t${e.employer.dates}` : ""}`] : []),
      `${e.title}${e.dates ? `\t${e.dates}` : ""}`, ...e.bullets,
    ])],
    education: () => (v.education.length ? ["EDUCATION", ...v.education.map((e) => `${e.degree}, ${e.school}${e.dates ? ` (${e.dates})` : ""}`)] : []),
    certifications: () => (v.certifications.length ? ["CERTIFICATIONS", ...v.certifications] : []),
  };
  return [...out, ...style.sections.flatMap((s) => blocks[s]())];
}
