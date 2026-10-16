import type { MasterProfile, TailoredResume } from "@/lib/types";

/** The resume as plain structured text. The DOCX file and the on-screen preview are both built from this, so they cannot disagree. */
export type ResumeView = {
  name: string; headline: string; contact: string; summary: string;
  skills: string[];
  experience: { title: string; company: string; dates: string; location: string | null; bullets: string[] }[];
  education: string[];
  certifications: string[];
};

/** Company, title and dates always come from the master profile, never from model output. */
export function resumeView(p: MasterProfile, t: TailoredResume): ResumeView {
  const b = p.basics;
  return {
    name: b.name,
    headline: t.headline || b.headline,
    contact: [b.email, b.phone, b.location, ...b.links].filter(Boolean).join("  |  "),
    summary: t.summary.text,
    skills: t.skillIds.map((id) => p.skills.find((s) => s.id === id)?.name).filter((x): x is string => !!x),
    experience: t.experience.flatMap((te) => {
      const e = p.experience.find((x) => x.id === te.experienceId);
      return e ? [{ title: e.title, company: e.company, dates: [e.start, e.end].filter(Boolean).join(" - "), location: e.location ?? null, bullets: te.bullets.map((x) => x.text) }] : [];
    }),
    education: p.education.map((ed) => `${ed.degree}, ${ed.school}${ed.start || ed.end ? ` (${[ed.start, ed.end].filter(Boolean).join(" - ")})` : ""}`),
    certifications: t.certificationIds.map((id) => p.certifications.find((c) => c.id === id)?.name).filter((x): x is string => !!x),
  };
}

/** Your master profile laid out as a resume with nothing selected or reworded: the "original" the tailored copy started from. */
export function masterAsTailored(p: MasterProfile): TailoredResume {
  return {
    headline: p.basics.headline,
    summary: { text: p.basics.summary, sourceIds: ["summary"] },
    experience: p.experience.map((e) => ({ experienceId: e.id, bullets: e.bullets.map((x) => ({ text: x.text, sourceIds: [x.id] })) })),
    skillIds: p.skills.map((s) => s.id),
    certificationIds: p.certifications.map((c) => c.id),
  };
}

/** Plain text of a resume, for the preview and for tests. */
export function resumeText(v: ResumeView): string[] {
  return [
    v.name, v.headline, v.contact, "SUMMARY", v.summary,
    ...(v.skills.length ? ["SKILLS", v.skills.join(", ")] : []),
    "EXPERIENCE",
    ...v.experience.flatMap((e) => [`${e.title}, ${e.company}   ${e.dates}${e.location ? `  |  ${e.location}` : ""}`, ...e.bullets]),
    ...(v.education.length ? ["EDUCATION", ...v.education] : []),
    ...(v.certifications.length ? ["CERTIFICATIONS", ...v.certifications] : []),
  ];
}
