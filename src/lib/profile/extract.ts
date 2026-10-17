import "server-only";
import { runStructured } from "@/lib/llm/registry";
import { assignIds, ExtractedProfile } from "./ids";
import { cleanPastedProfile } from "./linkedin";
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
- Skills: one entry per skill as {"name", "group", "kind"} (plus "extra" only as described below). "kind" is "competency" for items under Core Competencies and "technical" for items under Technical Skills; "group" is the sub-heading they sit under (for example "Delivery & Project Management"), or empty.
- "credentials" is the line of professional credentials under the name (for example "PMP | SFC"); "workStatus" is work authorisation shown on the resume (for example "Employment Pass"), or empty.`;

/** The master resume sets the profile's structure and wording; supporting documents (LinkedIn PDF, another resume, LinkedIn export) only add to it. */
export type ImportInput = { master?: Upload; supporting: Upload[]; pastedText?: string };

const MAX_PASTE = 60_000;
const MAX_SUPPORT = 30_000;

const WITH_MASTER = `
There are two kinds of source, each labelled in the input.
- MASTER RESUME: the authority. Build every section (summary, highlights, case studies, competencies, technical skills, experience, certifications, development, education, awards, credentials) from it alone, keeping its sections, headings, order and wording.
- SUPPORTING sources (LinkedIn profile, another resume): use them only to (a) fill a basics field the master resume leaves empty, and (b) add skills the master resume does not list. Mark every such added skill with "extra": true (omit "extra" for skills from the master resume); put it under a "group" only if the source gives one.
- Anything else found only in a supporting source (a role, a school, a certification) must NOT be added; instead write one line in "conflicts" such as "LinkedIn also lists <item>, which is not in your master resume".
- Where a supporting source disagrees with the master resume, the master resume wins; note the difference in "conflicts".`;

export async function importProfile(input: ImportInput, preferences: MasterProfile["preferences"]) {
  const pasted = cleanPastedProfile(input.pastedText ?? "").slice(0, MAX_PASTE);
  if (!input.master && input.supporting.length === 0 && pasted.length < 50) throw new Error("Upload your master resume (and, if you like, your LinkedIn PDF), or paste your profile text");

  const parts: string[] = [];
  if (input.master) parts.push(`===== MASTER RESUME: ${input.master.name} =====\n${await uploadToText(input.master)}`);
  for (const u of input.supporting) parts.push(`===== SUPPORTING SOURCE: ${u.name} =====\n${(await uploadToText(u)).slice(0, MAX_SUPPORT)}`);
  if (pasted) parts.push(`===== SUPPORTING SOURCE: LinkedIn profile (copied from the profile page) =====\n${pasted}`);

  const system = input.master ? SYSTEM + WITH_MASTER : SYSTEM;
  const { output, model } = await runStructured({ task: "extract", schema: ExtractedProfile, system, prompt: parts.join("\n\n"), budgetMs: 50_000 });
  return { profile: assignIds(output, preferences), conflicts: output.conflicts, model };
}
