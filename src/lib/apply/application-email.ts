import "server-only";
import { logActivity } from "@/lib/activity";
import { jobLogFields, type JobRef } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { sendEmail, smtpFromMailbox } from "@/lib/email";
import { mainProfileInUse } from "@/lib/scoped-db";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import { withLegacyFallback } from "@/lib/schema";
import { writeApplicationEmail } from "@/lib/tailor/email-draft";
import type { Runner } from "@/lib/tailor/tailor";
import type { ResumeStyle } from "@/lib/tailor/template";
import { assistedRecord } from "./submission";
import { contactEmailsFor, type ContactEmail } from "./contact-email";
import { loadDraft, saveDraft, type EmailDraft } from "./email-store";
import { logEvent } from "./events";
import { emailModeFor } from "./route";

type JobRow = JobRef & { id: string; title: string; company: string; description: string; url: string; apply_type: string };

/** Write (or rewrite) the email for an application. `to` forces a recipient you typed; otherwise the best address found in the posting is used. */
export async function writeEmailDraft(appId: string, o: { job: JobRow; run: Runner; style?: ResumeStyle; guidance?: string; to?: string; contacts?: ContactEmail[]; keepSent?: boolean }): Promise<EmailDraft | null> {
  const settings = await getSetting("email_apply");
  const contacts = o.contacts ?? contactEmailsFor(o.job);
  const to = (o.to ?? contacts[0]?.email ?? "").trim().toLowerCase();
  if (!to) return null;
  const mode = emailModeFor(o.job, true)!;
  const profile = await getProfile();
  const r = await writeApplicationEmail(profile, { ...o.job, style: o.style, guidance: o.guidance }, o.run);
  const old = o.keepSent ? await loadDraft(appId) : null;
  const draft: EmailDraft = {
    to, alternatives: contacts.filter((c) => c.email !== to), subject: r.content.subject.trim(), body: r.content.body.trim(), sourceIds: r.content.sourceIds,
    verified: r.verification.ok, issues: r.verification.issues, quality: r.quality, model: r.model, mode, auto: settings.enabled, sent: old?.sent ?? null, lastError: null, updatedAt: new Date().toISOString(),
  };
  await saveDraft(appId, draft);
  await logActivity({ kind: "email.drafted", level: draft.verified ? "info" : "warn", message: `Application email written for ${o.job.title} at ${o.job.company} to ${to}${draft.verified ? "" : ` (${draft.issues.length} claim(s) failed verification)`}`, ...jobLogFields(o.job), application_id: appId, status: draft.verified ? "verified" : "unverified", detail: { to, mode, quality: r.quality.score, model: r.model } }).catch(() => undefined);
  return draft;
}

const startOfTodayUtc = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

export type SendResult = { ok: true; to: string; already?: boolean } | { ok: false; error: string };

/**
 * Send the application email with the resume and cover letter attached, from your own mailbox. It never sends twice, only sends an
 * email whose claims were verified (unless you override), and respects the daily email limit.
 */
export async function sendApplicationEmail(appId: string, o: { actor: "user" | "schedule"; to?: string; override?: boolean; resend?: boolean }): Promise<SendResult> {
  const draft = await loadDraft(appId);
  if (!draft) return { ok: false, error: "There is no email for this application yet." };
  const fail = async (error: string, job?: JobRow | null): Promise<SendResult> => {
    await saveDraft(appId, { ...draft, lastError: error });
    await logEvent(appId, "email_failed", { to: draft.to, error }).catch(() => undefined);
    await logActivity({ kind: "application.failed", level: "warn", message: `Could not email the application: ${error}`, ...(job ? jobLogFields(job) : {}), application_id: appId, status: "failed", detail: { channel: "email", to: draft.to, error } }).catch(() => undefined);
    return { ok: false, error };
  };
  if (draft.sent && !o.resend) return { ok: true, to: draft.sent.to, already: true };
  const to = (o.to ?? draft.to).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail(`"${to}" is not an email address.`);
  if (!draft.verified && !o.override) return fail("The email contains claims that are not in your profile. Review it, or send it anyway after confirming.");

  const settings = await getSetting("email_apply");
  const since = startOfTodayUtc();
  const today = must<{ id: number }[]>(await db().from("apply_events").select("id").eq("kind", "email_sent").gte("at", since).limit(500), "count emails today").length;
  if (today >= settings.daily_cap) return fail(`The daily limit of ${settings.daily_cap} application emails has been reached. It can be sent tomorrow, or raise the limit in Settings.`);

  const app = must<{ id: string; job_id: string; status: string; resume_doc_id: string | null; cover_doc_id: string | null } | null>(await db().from("applications").select("id,job_id,status,resume_doc_id,cover_doc_id").eq("id", appId).maybeSingle(), "load application");
  if (!app) return { ok: false, error: "Application not found" };
  const job = must<JobRow | null>(await db().from("jobs").select("*").eq("id", app.job_id).maybeSingle(), "load job");
  const profile = await getProfile();
  const docs = must<{ id: string; kind: string; storage_path: string | null }[]>(await db().from("documents").select("id,kind,storage_path").in("id", [app.resume_doc_id, app.cover_doc_id].filter(Boolean) as string[]), "load documents");
  const attachments: { filename: string; content: Buffer }[] = [];
  const safe = (profile.basics.name || "Candidate").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Candidate";
  for (const d of docs) {
    if (!d.storage_path) continue;
    const dl = await db().storage.from("documents").download(d.storage_path);
    if (dl.error || !dl.data) return fail(`Could not read the ${d.kind === "resume" ? "resume" : "cover letter"} file to attach: ${dl.error?.message ?? "missing"}`, job);
    const ext = d.storage_path.split(".").pop() ?? "docx";
    attachments.push({ filename: `${safe}-${d.kind === "resume" ? "Resume" : "Cover-Letter"}.${ext}`, content: Buffer.from(await dl.data.arrayBuffer()) });
  }
  if (!attachments.some((a) => /Resume/.test(a.filename))) return fail("There is no resume file to attach.", job);

  const { creds } = await resolveCredentials();
  // each person applies from their own mailbox; the SMTP settings in the environment are the main profile's only
  const err = await sendEmail(smtpFromMailbox(creds.mailbox, (await mainProfileInUse()) ? process.env : {}), { to, subject: draft.subject, text: draft.body, attachments, fromName: profile.basics.name, replyTo: profile.basics.email || undefined });
  if (err) return fail(err, job);

  const at = new Date().toISOString();
  const sent = { at, to, attachments: attachments.map((a) => a.filename) };
  await saveDraft(appId, { ...draft, to, sent, lastError: null });
  await logEvent(appId, "email_sent", { to, subject: draft.subject, attachments: sent.attachments, actor: o.actor });
  if (job) await logActivity({ kind: "application.submitted", message: `Application emailed to ${to}: ${job.title} at ${job.company}`, ...jobLogFields(job), application_id: appId, status: "submitted", detail: { channel: "email", to, attachments: sent.attachments, mode: draft.mode } }).catch(() => undefined);

  // when the email IS the application, sending it completes the application
  if (draft.mode === "only") {
    const now = new Date(at);
    const patch = { status: "submitted", method: "assisted", submitted_at: at, lifecycle: "applied", error: null };
    must(await withLegacyFallback(
      () => db().from("applications").update({ ...patch, submission: { ...assistedRecord(job?.url ?? "", now), channel: "email", to, subject: draft.subject, attachments: sent.attachments } }).eq("id", appId).select("id"),
      () => db().from("applications").update(patch).eq("id", appId).select("id"),
    ), "mark emailed application submitted");
    await db().from("jobs").update({ status: "applied" }).eq("id", app.job_id);
  }
  return { ok: true, to };
}
