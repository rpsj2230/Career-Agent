import { z } from "zod";
import { MasterProfile } from "@/lib/types";

// Free models are sloppy about shape: a missing field, null, a number where text belongs, a single item instead of a list, or
// {"name": "x"} instead of "x". All of these are read as what was meant, so one cosmetic slip does not fail the whole import.
const text = z.preprocess((v) => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).text ?? "") : String(v)), z.string());
const optText = z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).text ?? "") || undefined : String(v)), z.string().optional());
const list = <T extends z.ZodType>(item: T) => z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(item));
const names = list(text).transform((xs) => xs.filter((x) => x.trim()));

const kind = z.preprocess((v) => {
  const k = String(v ?? "").toLowerCase();
  return k.includes("tech") ? "technical" : k.includes("comp") ? "competency" : undefined;
}, z.enum(["competency", "technical"]).optional());
// A skill is a plain name, {name, group, kind}, or a whole heading {group, kind, items: [...]} that is spread into one skill per item.
const flag = z.preprocess((v) => (v === true || String(v).toLowerCase() === "true" ? true : undefined), z.boolean().optional());
const skillItem = z.object({ name: text, group: optText, kind, extra: flag });
const skillList = z.preprocess((v) => {
  const xs = v == null ? [] : Array.isArray(v) ? v : [v];
  return xs.flatMap((x) => {
    if (x && typeof x === "object" && Array.isArray((x as { items?: unknown }).items)) {
      const g = x as { items: unknown[]; group?: unknown; kind?: unknown };
      return g.items.map((name) => ({ name, group: g.group, kind: g.kind, extra: (g as { extra?: unknown }).extra }));
    }
    return [typeof x === "object" && x ? x : { name: x }];
  });
}, z.array(skillItem));

/** What the model returns: the same shape as the master profile but without ids. */
export const ExtractedProfile = z.object({
  basics: z.preprocess((v) => v ?? {}, z.object({
    name: text, email: text, phone: text, location: text, headline: text, summary: text, links: names,
    credentials: text, workStatus: text,
  })),
  experience: list(z.object({
    company: text, title: text, location: optText, start: optText, end: optText, bullets: names,
  })),
  education: list(z.object({ school: text, degree: text, start: optText, end: optText })),
  skills: skillList.transform((xs) => xs.filter((x) => x.name.trim())),
  certifications: names,
  highlights: names,
  caseStudies: names,
  development: names,
  awards: names,
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

function dedupeSkills(xs: ExtractedProfile["skills"]) {
  const seen = new Set<string>();
  const out: { name: string; group?: string; kind?: "competency" | "technical"; extra?: boolean }[] = [];
  // a supplementary skill that the master resume already lists is not added twice, whichever source came first
  const resumeNames = new Set(xs.filter((s) => !s.extra).map((s) => s.name.trim().toLowerCase()));
  for (const s of xs) {
    const name = s.name.trim().toLowerCase();
    const k = `${s.kind ?? ""}|${name}`;
    if (!name || seen.has(k) || (s.extra && resumeNames.has(name))) continue;
    seen.add(k);
    out.push({ name: s.name.trim(), ...(s.group ? { group: s.group.trim() } : {}), ...(s.kind ? { kind: s.kind } : {}), ...(s.extra ? { extra: true } : {}) });
  }
  return out;
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
    skills: dedupeSkills(x.skills).map((s, i) => ({ id: `skill${i + 1}`, ...s })),
    certifications: dedupe(x.certifications).map((name, i) => ({ id: `cert${i + 1}`, name })),
    highlights: x.highlights.map((t) => t.trim()).filter(Boolean).map((text, i) => ({ id: `hl${i + 1}`, text })),
    caseStudies: dedupe(x.caseStudies).map((title, i) => ({ id: `cs${i + 1}`, title })),
    development: dedupe(x.development).map((name, i) => ({ id: `dev${i + 1}`, name })),
    awards: dedupe(x.awards).map((name, i) => ({ id: `aw${i + 1}`, name })),
  });
}
