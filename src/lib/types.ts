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

/**
 * Output the model is asked to produce. The schemas are forgiving about shape (a missing list is empty, a number may
 * arrive as text) because free models are sloppy; the verifier, not the schema, decides whether the content is acceptable
 * (an empty "sourceIds" is reported as "no source fact cited").
 */
export const TailoredResume = z.object({
  headline: z.string().default(""),
  summary: z.object({ text: z.string(), sourceIds: z.array(z.string()).default([]) }),
  experience: z.array(
    z.object({
      experienceId: z.string(),
      bullets: z.array(z.object({ text: z.string(), sourceIds: z.array(z.string()).default([]) })).default([]),
    }),
  ).default([]),
  skillIds: z.array(z.string()).default([]),
  certificationIds: z.array(z.string()).default([]),
});
export type TailoredResume = z.infer<typeof TailoredResume>;

export const CoverLetter = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()).default([]),
});
export type CoverLetter = z.infer<typeof CoverLetter>;

/** `score` may come back as "82", 82.5 or 82; it is rounded wherever it is stored (see roundScore). */
export const JobScore = z.object({
  score: z.coerce.number().min(0).max(100),
  matchedSkills: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  seniorityFit: z.string().default("unknown"),
  locationVisaFit: z.string().default("unknown"),
  salarySignal: z.string().default("unknown"),
  summary: z.string().default(""),
});
export type JobScore = z.infer<typeof JobScore>;
export const roundScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export type Task = "score" | "tailor" | "extract";
