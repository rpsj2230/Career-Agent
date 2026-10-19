import "server-only";
import { sendEmail, smtpFromMailbox, type SmtpConfig } from "@/lib/email";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { labelled, recipients, subjectFor } from "@/lib/notify-rules";
import { sendTelegram } from "@/lib/notify";
import { getOwnerEmail } from "@/lib/owner";
import { withProfile } from "@/lib/profile-context";
import { defaultProfile, getProfileRecord, listProfiles, profilesReady } from "@/lib/profiles-store";
import { currentProfileId } from "@/lib/profile-context";
import { mainProfileInUse } from "@/lib/scoped-db";

/** The mailbox this profile sends from; a profile without one borrows the main profile's so its owner still hears about things. */
async function senderFor(main: boolean): Promise<SmtpConfig | null> {
  const own = smtpFromMailbox((await resolveCredentials()).creds.mailbox, main ? process.env : {});
  if (own || main) return own;
  const d = await defaultProfile();
  if (!d) return null;
  return withProfile(d.id, async () => smtpFromMailbox((await resolveCredentials()).creds.mailbox, process.env));
}

async function context(): Promise<{ name: string | null; own: string | null; count: number; main: boolean }> {
  try {
    if (await profilesReady()) {
      const p = await getProfileRecord(await currentProfileId());
      return { name: p?.name ?? null, own: p?.email ?? null, count: (await listProfiles()).length, main: await mainProfileInUse() };
    }
  } catch { /* no profile context (a plain script): send as the app */ }
  return { name: null, own: null, count: 1, main: true };
}

export type EmailResult = { emailed: string[]; error: string | null };

/** Email to you and to the profile's own address (plus `extra`), from the profile's mailbox. Never throws. */
export async function emailProfile(text: string, subject: string | undefined, extra: (string | null | undefined)[] = []): Promise<EmailResult> {
  const out: EmailResult = { emailed: [], error: null };
  try {
    const c = await context();
    const to = recipients(await getOwnerEmail().catch(() => null), c.own, extra);
    if (!to.length) { out.error = "No address to send to."; return out; }
    const cfg = await senderFor(c.main);
    const subj = subjectFor(text, subject, c.name, c.count);
    for (const addr of to) {
      const err = await sendEmail(cfg, { to: addr, subject: subj, text: `${labelled(text, c.name, c.count)}\n\n— Career Agent`, fromName: c.name ? `Career Agent (${c.name})` : "Career Agent" });
      if (err === null) out.emailed.push(addr); else out.error = err;
    }
  } catch (e) { out.error = e instanceof Error ? e.message : String(e); }
  return out;
}

export type NotifyResult = { telegram: boolean; emailed: string[]; emailError: string | null };

/**
 * Tell people about something that happened for the profile in use: Telegram (yours, with the profile's name once there are several),
 * and email to you and to the profile's own address. Never throws; a channel that is not set up is simply skipped.
 */
export async function notifyProfile(text: string, o: { subject?: string; email?: boolean; telegram?: boolean } = {}): Promise<NotifyResult> {
  const result: NotifyResult = { telegram: false, emailed: [], emailError: null };
  if (o.telegram !== false) {
    const c = await context();
    result.telegram = await sendTelegram(labelled(text, c.name, c.count)).catch(() => false);
  }
  if (o.email !== false) {
    const e = await emailProfile(text, o.subject);
    result.emailed = e.emailed;
    result.emailError = e.error;
  }
  return result;
}
