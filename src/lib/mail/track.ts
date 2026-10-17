import "server-only";
import { logActivity } from "@/lib/activity";
import { alertOnce } from "@/lib/alerts";
import { db, must } from "@/lib/db";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { imapSource, type MailSource } from "@/lib/jobs/mailbox";
import { getSetting } from "@/lib/settings";
import { classifyReply, matchApplication, nextLifecycle, type AppRef } from "./replies";

const SEEN_KEY = "replies_seen";

/**
 * Read recent mail (opt-in, read-only) and update your applications from what employers wrote: an interview invitation, a rejection or an
 * offer. The message is matched to the application by the company's name, only the classification and the subject are kept, and every
 * change is logged. `source` can be replaced in tests. Returns what changed; never throws.
 */
export async function trackReplies(source?: MailSource): Promise<{ checked: number; updated: { applicationId: string; company: string; reply: string }[] }> {
  const out = { checked: 0, updated: [] as { applicationId: string; company: string; reply: string }[] };
  try {
    if (!(await getSetting("replies")).enabled) return out;
    const src = source ?? (await sourceFromCredentials());
    if (!src?.fetchReplies) return out;
    const apps = await loadApps();
    if (!apps.length) return out;
    const seenRow = must<{ value: { ids: string[] } } | null>(await db().from("settings").select("value").eq("key", SEEN_KEY).maybeSingle(), "load seen replies");
    const seen = new Set(seenRow?.value?.ids ?? []);
    const mails = await src.fetchReplies({ sinceDays: 30, max: 250 });
    for (const m of mails) {
      const id = m.messageId ?? `${m.from}|${m.subject}|${m.date?.toISOString()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.checked++;
      const reply = classifyReply(m);
      if (!reply) continue;
      const app = matchApplication(m, apps.map((a) => a.ref));
      if (!app) continue;
      const row = apps.find((a) => a.ref.id === app.id)!;
      const next = nextLifecycle(row.ref.lifecycle, reply);
      if (!next) continue;
      const upd = await db().from("applications").update({ lifecycle: next }).eq("id", app.id).select("id");
      if (upd.error || !upd.data?.length) continue;
      row.ref.lifecycle = next;
      out.updated.push({ applicationId: app.id, company: row.ref.company, reply });
      const label = reply === "interview" ? "an interview invitation" : reply === "offer" ? "an offer" : "a rejection";
      await logActivity({ kind: "application.lifecycle", message: `Reply detected from ${row.ref.company}: ${label}`, status: next, application_id: app.id, job_id: row.jobId, company: row.ref.company, detail: { reply, subject: m.subject.slice(0, 160), via: "mailbox" } });
      if (reply !== "rejected") await alertOnce(`reply:${id}`, 24 * 14, `Career Agent: ${row.ref.company} sent ${label}. Open the application to respond.`);
    }
    must(await db().from("settings").upsert({ key: SEEN_KEY, value: { ids: [...seen].slice(-600) }, updated_at: new Date().toISOString() }).select("key"), "save seen replies");
  } catch (e) {
    console.error(`[replies] could not check mail: ${e instanceof Error ? e.message : e}`);
  }
  return out;
}

async function sourceFromCredentials(): Promise<MailSource | null> {
  const { creds } = await resolveCredentials();
  return creds.mailbox ? imapSource(creds.mailbox) : null;
}

type AppRow = { ref: AppRef; jobId: string };
async function loadApps(): Promise<AppRow[]> {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const res = await db().from("applications").select("id,job_id,lifecycle,submitted_at,job:jobs(company)").eq("status", "submitted").gte("submitted_at", since).limit(500);
  if (res.error) return [];
  return (res.data as unknown as { id: string; job_id: string; lifecycle: string; submitted_at: string | null; job: { company: string } | { company: string }[] | null }[])
    .map((r) => ({ ref: { id: r.id, company: (Array.isArray(r.job) ? r.job[0] : r.job)?.company ?? "", submittedAt: r.submitted_at, lifecycle: r.lifecycle }, jobId: r.job_id }))
    .filter((a) => a.ref.company);
}
