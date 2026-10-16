import { z } from "zod";

/** Every piece of resume content that may be reused carries a stable id ("fact id"). */
export const Bullet = z.object({ id: z.string(), text: z.string().min(1) });

export const Experience = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(), // "Present" allowed
  bullets: z.array(Bullet),
});

export const Education = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const Named = z.object({ id: z.string(), name: z.string().min(1) });

export const MasterProfile = z.object({
  basics: z.object({
    name: z.string().default(""),
    email: z.string().default(""),
    phone: z.string().default(""),
    location: z.string().default(""),
    headline: z.string().default(""),
    summary: z.string().default(""),
    links: z.array(z.string()).default([]),
  }),
  preferences: z
    .object({
      countries: z.array(z.string()).default([]), // ISO-2 lower case, e.g. "in"
      roles: z.array(z.string()).default([]),
      currentCtc: z.string().optional(),
      expectedCtc: z.string().optional(),
      noticePeriod: z.string().optional(),
      visaStatus: z.string().optional(),
      relocate: z.boolean().optional(),
    })
    .default({ countries: [], roles: [] }),
  experience: z.array(Experience).default([]),
  education: z.array(Education).default([]),
  skills: z.array(Named).default([]),
  certifications: z.array(Named).default([]),
});
export type MasterProfile = z.infer<typeof MasterProfile>;

/** Output the model is asked to produce for a tailored resume. */
export const TailoredResume = z.object({
  headline: z.string(),
  summary: z.object({ text: z.string(), sourceIds: z.array(z.string()) }),
  experience: z.array(
    z.object({
      experienceId: z.string(),
      bullets: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()) })),
    }),
  ),
  skillIds: z.array(z.string()),
  certificationIds: z.array(z.string()).default([]),
});
export type TailoredResume = z.infer<typeof TailoredResume>;

export const CoverLetter = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()),
});
export type CoverLetter = z.infer<typeof CoverLetter>;

export const JobScore = z.object({
  score: z.number().int().min(0).max(100),
  matchedSkills: z.array(z.string()),
  gaps: z.array(z.string()),
  seniorityFit: z.string(),
  locationVisaFit: z.string(),
  salarySignal: z.string(),
  summary: z.string(),
});
export type JobScore = z.infer<typeof JobScore>;

export type Task = "score" | "tailor" | "extract";
