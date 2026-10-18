import "server-only";
import { db, must } from "@/lib/db";
import { putSetting } from "@/lib/settings";
import type { CoverQuality } from "@/lib/tailor/quality";
import type { ContactEmail } from "./contact-email";
import type { EmailMode } from "./route";

/**
 * The email that goes with an application: recipient, subject, body, and whether it was sent. It is kept as one small record per
 * application in the settings table (key "email:<application id>"), so it needs no database change. Attachments are not stored here:
 * they are read from the application's current resume and cover letter at the moment of sending, so a regenerated resume is what gets attached.
 */
export type EmailDraft = {
  to: string;
  alternatives: ContactEmail[];
  subject: string;
  body: string;
  sourceIds: string[];
  /** the checker passed (every claim comes from your profile); an email you edited yourself counts as yours */
  verified: boolean;
  edited?: boolean;
  issues: { where: string; problem: string }[];
  quality?: CoverQuality;
  model: string;
  /** "only": the email is the application. "also": it goes in addition to the portal or form. */
  mode: EmailMode;
  /** send it when the application is approved */
  auto: boolean;
  sent?: { at: string; to: string; attachments: string[] } | null;
  lastError?: string | null;
  updatedAt: string;
};

const key = (appId: string) => `email:${appId}`;

export async function loadDraft(appId: string): Promise<EmailDraft | null> {
  const row = must<{ value: EmailDraft } | null>(await db().from("settings").select("value").eq("key", key(appId)).maybeSingle(), "load email draft");
  return row?.value ?? null;
}
export const saveDraft = (appId: string, d: EmailDraft) => putSetting(key(appId), { ...d, updatedAt: new Date().toISOString() });

/** Which of these applications have an email, and its state, for the list page. */
export async function draftStates(appIds: string[]): Promise<Map<string, { mode: EmailMode; sent: boolean }>> {
  const out = new Map<string, { mode: EmailMode; sent: boolean }>();
  if (appIds.length === 0) return out;
  const rows = must<{ key: string; value: EmailDraft }[]>(await db().from("settings").select("key,value").in("key", appIds.map(key)), "load email drafts");
  for (const r of rows) out.set(r.key.slice("email:".length), { mode: r.value.mode, sent: !!r.value.sent });
  return out;
}
