import { z } from "zod";

/** One value the worker typed, picked or uploaded. Secrets are never entered by the worker, so values are stored in full. */
export const FieldEntry = z.object({
  label: z.string(),
  value: z.string(),
  kind: z.enum(["text", "select", "radio", "file", "checkbox"]),
  /** "ai": the answer was written from your profile for a question that was not in your answer bank */
  source: z.enum(["profile", "answers", "upload", "ai", "rule"]),
});
export type FieldEntry = z.infer<typeof FieldEntry>;

export const SubmissionRecord = z.object({
  version: z.literal(1),
  method: z.enum(["automated", "assisted"]),
  outcome: z.enum(["submitted", "needs_input", "failed", "marked_submitted"]),
  started_at: z.string(),
  finished_at: z.string(),
  target_url: z.string(),
  final_url: z.string().nullable(),
  fields: z.array(FieldEntry),
  files: z.array(z.object({ role: z.enum(["resume", "cover_letter"]), name: z.string(), bytes: z.number(), sha256: z.string(), storage_path: z.string().nullable() })),
  unanswered: z.array(z.string()),
  confirmation: z.object({ text: z.string(), screenshot: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
  steps: z.number(),
  note: z.string().nullable().default(null),
});
export type SubmissionRecord = z.infer<typeof SubmissionRecord>;

/** A few lines around the first match of `re`, trimmed, so the page shows what the employer actually said. */
export function confirmationSnippet(pageText: string, re: RegExp, max = 400): string {
  const text = pageText.replace(/\s+/g, " ").trim();
  const m = re.exec(text);
  if (!m) return text.slice(0, max);
  const start = Math.max(0, m.index - 80);
  return text.slice(start, Math.min(text.length, start + max)).trim();
}

/** The record for an application you submitted yourself (assisted): what the app knows is only who, when and how. */
export function assistedRecord(target: string, now: Date): SubmissionRecord {
  return {
    version: 1, method: "assisted", outcome: "marked_submitted", started_at: now.toISOString(), finished_at: now.toISOString(),
    target_url: target, final_url: null, fields: [], files: [], unanswered: [], confirmation: null, error: null, steps: 0,
    note: "You submitted this application yourself on the employer's site and marked it as sent here. The values you entered there are not visible to this app.",
  };
}
