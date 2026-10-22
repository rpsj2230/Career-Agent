import { z } from "zod";
import type { MasterProfile } from "@/lib/types";
import { assignIds, ExtractedProfile } from "./ids";

/**
 * A ready-made profile file: the same structure the importer reads from your resume (basics, experience with bullets as plain text,
 * education, skills, certifications), plus an optional "preferences" block. It needs no AI model, so it cannot fail on a slow
 * or rate-limited provider. Like every import it becomes a DRAFT that you review before it is used.
 */
const Prefs = z.object({
  countries: z.array(z.string()).optional(), roles: z.array(z.string()).optional(), payCountry: z.string().optional(),
  currentCtc: z.string().optional(), expectedCtc: z.string().optional(), noticePeriod: z.string().optional(), visaStatus: z.string().optional(), relocate: z.boolean().optional(), languages: z.string().optional(),
}).partial();
const File = ExtractedProfile.extend({ preferences: Prefs.optional() });

export function parseProfileJson(text: string, existing: MasterProfile["preferences"]): { profile: MasterProfile; conflicts: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("That file is not valid JSON"); }
  const parsed = File.safeParse(raw);
  if (!parsed.success || (parsed.data.experience.length === 0 && !parsed.data.basics.name)) throw new Error("That file does not look like a profile (expected basics, experience, education, skills and certifications)");
  const { preferences, ...extracted } = parsed.data;
  const merged = { ...existing, ...Object.fromEntries(Object.entries(preferences ?? {}).filter(([, v]) => v !== undefined && v !== "")) } as MasterProfile["preferences"];
  merged.countries = (merged.countries ?? []).map((c) => c.toLowerCase());
  return { profile: assignIds(extracted, merged), conflicts: extracted.conflicts };
}
