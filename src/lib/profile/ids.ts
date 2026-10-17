import { z } from "zod";
import { MasterProfile } from "@/lib/types";

// Free models are sloppy about shape: a missing field, null, a number where text belongs, a single item instead of a list, or
// {"name": "x"} instead of "x". All of these are read as what was meant, so one cosmetic slip does not fail the whole import.
const text = z.preprocess((v) => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).text ?? "") : String(v)), z.string());
const optText = z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).text ?? "") || undefined : String(v)), z.string().optional());
const list = <T extends z.ZodType>(item: T) => z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(item));
const names = list(text).transform((xs) => xs.filter((x) => x.trim()));

/** What the model returns: the same shape as the master profile but without ids. */
export const ExtractedProfile = z.object({
  basics: z.preprocess((v) => v ?? {}, z.object({
    name: text, email: text, phone: text, location: text, headline: text, summary: text, links: names,
  })),
  experience: list(z.object({
    company: text, title: text, location: optText, start: optText, end: optText, bullets: names,
  })),
  education: list(z.object({ school: text, degree: text, start: optText, end: optText })),
  skills: names,
  certifications: names,
  conflicts: names.describe("Facts where sources disagree, written for the user to resolve"),
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
