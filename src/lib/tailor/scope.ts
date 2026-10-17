import type { MasterProfile, TailoredResume } from "@/lib/types";
import { masterAsTailored } from "./sections";

/**
 * What the agent may change in your resume for each job. Everything else is always exactly as in your master resume:
 * your name and contact details, each employer, your job title there, its location and dates, your education and certifications.
 */
export type TailoringScope = { headline: boolean; summary: boolean; bullets: boolean; skills: boolean };
export const DEFAULT_SCOPE: TailoringScope = { headline: true, summary: true, bullets: true, skills: true };

export const SCOPE_LABELS: Record<keyof TailoringScope, { label: string; help: string }> = {
  headline: { label: "Headline / target job title", help: "The title line under your name, matched to the job's title (for example \"Senior Product Manager\"). Always built from titles you have really held." },
  summary: { label: "Summary", help: "The short opening paragraph, written around what this job asks for, using only facts from your profile." },
  bullets: { label: "Responsibilities under each employer", help: "Which of your own bullets are shown for each role, in which order, and how they are worded to match the job's language. Employers, your job titles and dates never change." },
  skills: { label: "Skills", help: "Which of your skills are listed and in which order, putting the ones the job asks for first. Skills you do not have are never added." },
};

/** Put back the master version of every part you locked. The master text is already your own, so it stays verified. */
export function applyScope(content: TailoredResume, profile: MasterProfile, scope: TailoringScope = DEFAULT_SCOPE): TailoredResume {
  if (scope.headline && scope.summary && scope.bullets && scope.skills) return content;
  const master = masterAsTailored(profile);
  return {
    ...content,
    headline: scope.headline ? content.headline : master.headline,
    summary: scope.summary ? content.summary : master.summary,
    experience: scope.bullets ? content.experience : master.experience,
    skillIds: scope.skills ? content.skillIds : master.skillIds,
  };
}

/** A made-up profile so the template can be shown before yours is imported. It never reaches an application. */
export const SAMPLE_PROFILE: MasterProfile = {
  basics: { name: "Your Name", email: "you@example.com", phone: "+00 0000 000000", location: "City, Country", headline: "Product Manager", summary: "Product manager with several years of experience taking products from idea to launch.", links: ["linkedin.com/in/your-name"] },
  preferences: { countries: [], roles: [] },
  experience: [
    { id: "exp1", company: "Latest Company", title: "Senior Product Manager", location: "City", start: "Jan 2022", end: "Present", bullets: [{ id: "exp1.b1", text: "Led the roadmap for a product used by thousands of customers." }, { id: "exp1.b2", text: "Worked with engineering and design to ship features every quarter." }, { id: "exp1.b3", text: "Defined success metrics and reported results to leadership." }] },
    { id: "exp2", company: "Earlier Company", title: "Product Manager", location: "City", start: "Jun 2018", end: "Dec 2021", bullets: [{ id: "exp2.b1", text: "Owned the onboarding experience and improved activation." }, { id: "exp2.b2", text: "Ran discovery interviews and turned findings into requirements." }] },
  ],
  education: [{ id: "edu1", school: "University Name", degree: "Bachelor of Technology", start: "2014", end: "2018" }],
  skills: ["Roadmapping", "Stakeholder management", "SQL", "A/B testing", "User research"].map((name, i) => ({ id: `skill${i + 1}`, name })),
  certifications: [{ id: "cert1", name: "Certification name" }],
};
