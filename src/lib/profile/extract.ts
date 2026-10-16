import "server-only";
import { runStructured } from "@/lib/llm/registry";
import { assignIds, ExtractedProfile } from "./ids";
import { uploadToText, type Upload } from "./parse";
import type { MasterProfile } from "@/lib/types";

const SYSTEM = `You convert resumes and LinkedIn exports into structured career data.
Rules:
- Use ONLY information present in the sources. Never infer, embellish or add skills, numbers, dates or employers.
- Keep each bullet as close to the original wording as possible; split long paragraphs into separate bullets.
- Dates as written (e.g. "Jan 2021", "2019"); use "Present" for current roles.
- If two sources disagree (dates, titles, employers), keep the more specific one and list the disagreement in "conflicts".
- Empty string for any basics field that is not present.`;

export async function importProfile(uploads: Upload[], preferences: MasterProfile["preferences"]) {
  if (uploads.length === 0) throw new Error("No files uploaded");
  const parts: string[] = [];
  for (const u of uploads) parts.push(`===== SOURCE: ${u.name} =====\n${await uploadToText(u)}`);
  const { output, model } = await runStructured({
    task: "extract",
    schema: ExtractedProfile,
    system: SYSTEM,
    prompt: parts.join("\n\n"),
  });
  return { profile: assignIds(output, preferences), conflicts: output.conflicts, model };
}
