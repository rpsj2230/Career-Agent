import { z } from "zod";
import { MasterProfile } from "@/lib/types";

/** What the model returns: the same shape as the master profile but without ids. */
export const ExtractedProfile = z.object({
  basics: z.object({
    name: z.string(), email: z.string(), phone: z.string(), location: z.string(),
    headline: z.string(), summary: z.string(), links: z.array(z.string()),
  }),
  experience: z.array(z.object({
    company: z.string(), title: z.string(), location: z.string().optional(),
    start: z.string().optional(), end: z.string().optional(), bullets: z.array(z.string()),
  })),
  education: z.array(z.object({
    school: z.string(), degree: z.string(), start: z.string().optional(), end: z.string().optional(),
  })),
  skills: z.array(z.string()),
  certifications: z.array(z.string()),
  conflicts: z.array(z.string()).describe("Facts where sources disagree, written for the user to resolve"),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfile>;

function dedupe(xs: string[]): string[] {
  const seen = new Map<string, string>();
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, x.trim()); // keep the first spelling
  }
  return [...seen.values()];
}

/** Ids are assigned by code, never by the model, so they are stable and collision-free. */
export function assignIds(x: ExtractedProfile, preferences: MasterProfile["preferences"]): MasterProfile {
  return MasterProfile.parse({
    basics: x.basics,
    preferences,
    experience: x.experience.map((e, i) => ({
      id: `exp${i + 1}`,
      company: e.company, title: e.title, location: e.location, start: e.start, end: e.end,
      bullets: e.bullets.filter((b) => b.trim()).map((text, j) => ({ id: `exp${i + 1}.b${j + 1}`, text: text.trim() })),
    })),
    education: x.education.map((e, i) => ({ id: `edu${i + 1}`, ...e })),
    skills: dedupe(x.skills).map((name, i) => ({ id: `skill${i + 1}`, name })),
    certifications: dedupe(x.certifications).map((name, i) => ({ id: `cert${i + 1}`, name })),
  });
}
