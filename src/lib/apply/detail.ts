import { SubmissionRecord } from "./submission";

export type DiffRow = { experienceId: string; tailored: string; original: string[]; changed: boolean };

/** How much of the resume was reworded, for the one-line summary above the change log. */
export function summariseDiff(diff: DiffRow[] | null | undefined): { total: number; changed: number; kept: number } {
  const rows = diff ?? [];
  const changed = rows.filter((r) => r.changed).length;
  return { total: rows.length, changed, kept: rows.length - changed };
}

const COMPARED = ["title", "company", "description", "url", "salary_text", "location"] as const;

/** Fields of the live posting that differ from what the application was prepared with (the employer or a re-scan changed it). */
export function changedSince(snapshot: Record<string, unknown> | null | undefined, live: Record<string, unknown> | null | undefined): string[] {
  if (!snapshot || !live) return [];
  return COMPARED.filter((k) => (snapshot[k] ?? null) !== (live[k] ?? null));
}

export type SubmissionView =
  | { kind: "record"; record: SubmissionRecord }
  | { kind: "none"; reason: "not_submitted" | "no_record" };

/**
 * What to show in the submission section: the full record when there is one, an honest "not yet" for applications
 * still waiting, and "no record" for ones submitted before detailed records existed (only labels were kept then).
 */
export function submissionView(app: { status: string; submission?: unknown }): SubmissionView {
  const parsed = SubmissionRecord.safeParse(app.submission);
  if (parsed.success) return { kind: "record", record: parsed.data };
  const done = ["submitted", "needs_input", "failed"].includes(app.status);
  return { kind: "none", reason: done ? "no_record" : "not_submitted" };
}

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
