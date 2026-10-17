import "server-only";
import { runStructured } from "@/lib/llm/registry";
import { assignIds, ExtractedProfile } from "./ids";
import { cleanPastedProfile, normalizeLinkedInUrl } from "./linkedin";
import { uploadToText, type Upload } from "./parse";
import type { MasterProfile } from "@/lib/types";

const SYSTEM = `You convert resumes and LinkedIn exports into structured career data.
Rules:
- Use ONLY information present in the sources. Never infer, embellish or add skills, numbers, dates or employers.
- Keep each bullet as close to the original wording as possible; split long paragraphs into separate bullets.
- Dates as written (e.g. "Jan 2021", "2019"); use "Present" for current roles.
- If two sources disagree (dates, titles, employers), keep the more specific one and list the disagreement in "conflicts".
- Empty string for any basics field that is not present.
- Keep the resume's own sections apart. "highlights" are the Career Highlights achievements; "caseStudies" are case study titles; "certifications" are professional certifications; "development" is courses and training; "awards" are awards and recognition.
- Skills: one entry per skill as {"name", "group", "kind"}. "kind" is "competency" for items under Core Competencies and "technical" for items under Technical Skills; "group" is the sub-heading they sit under (for example "Delivery & Project Management"), or empty.
- "credentials" is the line of professional credentials under the name (for example "PMP | SFC"); "workStatus" is work authorisation shown on the resume (for example "Employment Pass"), or empty.`;

export type ImportInput = { uploads: Upload[]; pastedText?: string; linkedinUrl?: string };

const MAX_PASTE = 60_000;

export async function importProfile(input: ImportInput, preferences: MasterProfile["preferences"]) {
  const pasted = cleanPastedProfile(input.pastedText ?? "").slice(0, MAX_PASTE);
  if (input.uploads.length === 0 && pasted.length < 50) throw new Error("Upload a file or paste your profile text (at least a few lines)");
  const linkedin = input.linkedinUrl?.trim() ? normalizeLinkedInUrl(input.linkedinUrl) : null;
  if (input.linkedinUrl?.trim() && !linkedin) throw new Error("That is not a LinkedIn profile link (expected linkedin.com/in/your-name)");

  const parts: string[] = [];
  for (const u of input.uploads) parts.push(`===== SOURCE: ${u.name} =====\n${await uploadToText(u)}`);
  if (pasted) parts.push(`===== SOURCE: LinkedIn profile (copied from the profile page) =====\n${pasted}`);

  const { output, model } = await runStructured({ task: "extract", schema: ExtractedProfile, system: SYSTEM, prompt: parts.join("\n\n"), budgetMs: 50_000 });
  const profile = assignIds(output, preferences);
  if (linkedin && !profile.basics.links.some((l) => normalizeLinkedInUrl(l) === linkedin)) profile.basics.links.unshift(linkedin);
  return { profile, conflicts: output.conflicts, model };
}
