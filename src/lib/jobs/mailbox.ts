import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { ALERT_SENDER_DOMAINS, isApplicationReceipt, parseAlertEmail, type AlertMail } from "./email-parse";
import type { NormalizedJob } from "./normalize";
import type { ReplyMail } from "@/lib/mail/replies";

export type MailboxConfig = { host: string; user: string; password: string; port?: number; folder?: string };

/** The one thing the scan needs from a mailbox, so it can be replaced in tests. */
export interface MailSource {
  fetchRecent(o: { sinceDays: number; max: number }): Promise<AlertMail[]>;
  /** recent messages from anyone, read in memory only, to spot replies to your applications (opt-in; see mail/track.ts) */
  fetchReplies?(o: { sinceDays: number; max: number }): Promise<ReplyMail[]>;
}

/** Messages a person can act on, in place of the raw socket errors. */
export function explainImapError(e: unknown, cfg: Pick<MailboxConfig, "host" | "user">): string {
  const err = e as { code?: string; responseText?: string; response?: string; message?: string; authenticationFailed?: boolean };
  const text = `${err.code ?? ""} ${err.responseText ?? ""} ${err.response ?? ""} ${err.message ?? ""}`;
  if (err.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(text)) {
    return `${cfg.host} rejected the sign-in for ${cfg.user}. Use an app password (not your normal password); for Gmail turn on 2-step verification first, and make sure IMAP is enabled.`;
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return `Could not find the server "${cfg.host}". Check the spelling (for example imap.gmail.com).`;
  if (/ETIMEDOUT|ECONNREFUSED|Timeout|timed out/i.test(text)) return `Could not connect to ${cfg.host}. Check the server name and port (993 for TLS), and that IMAP is turned on for this mailbox.`;
  if (/mailbox doesn't exist|NONEXISTENT|Unknown Mailbox|Mailbox not found|TRYCREATE/i.test(text)) return `The folder was not found in ${cfg.user}'s mailbox. Leave the folder empty for INBOX, or use the exact label name.`;
  if (/certificate|self.signed|SSL|TLS/i.test(text)) return `The secure connection to ${cfg.host} failed (${err.message ?? "certificate problem"}). Check the server name and port.`;
  return `Could not read the mailbox: ${err.responseText ?? err.message ?? String(e)}`.slice(0, 400);
}

/** Read-only IMAP. Only messages from the portals' own domains are fetched, and nothing is marked, moved or deleted. */
export function imapSource(cfg: MailboxConfig): MailSource {
  return {
    async fetchRecent({ sinceDays, max }) {
      const port = cfg.port ?? 993;
      const client = new ImapFlow({
        host: cfg.host, port, secure: port === 993, auth: { user: cfg.user, pass: cfg.password }, logger: false,
        socketTimeout: 45_000, greetingTimeout: 15_000, connectionTimeout: 15_000,
      });
      client.on("error", () => undefined); // surfaced through the awaited calls below
      const out: AlertMail[] = [];
      try {
        await client.connect();
        const lock = await client.getMailboxLock(cfg.folder || "INBOX", { readOnly: true });
        try {
          const since = new Date(Date.now() - sinceDays * 86_400_000);
          const found = await client.search({ since, or: ALERT_SENDER_DOMAINS.map((d) => ({ from: d })) }, { uid: true });
          const uids = (found || []).slice(-max);
          if (uids.length) {
            for await (const msg of client.fetch(uids, { source: true, internalDate: true, envelope: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed = await simpleParser(msg.source);
              out.push({
                from: parsed.from?.text ?? msg.envelope?.from?.[0]?.address ?? "",
                subject: parsed.subject ?? msg.envelope?.subject ?? "",
                html: typeof parsed.html === "string" ? parsed.html : "",
                text: parsed.text,
                date: parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : undefined),
                messageId: parsed.messageId,
              });
            }
          }
        } finally { lock.release(); }
      } catch (e) {
        throw new Error(explainImapError(e, cfg));
      } finally {
        await client.logout().catch(() => client.close());
      }
      return out;
    },

    async fetchReplies({ sinceDays, max }) {
      const port = cfg.port ?? 993;
      const client = new ImapFlow({
        host: cfg.host, port, secure: port === 993, auth: { user: cfg.user, pass: cfg.password }, logger: false,
        socketTimeout: 60_000, greetingTimeout: 15_000, connectionTimeout: 15_000,
      });
      client.on("error", () => undefined);
      const out: ReplyMail[] = [];
      try {
        await client.connect();
        const lock = await client.getMailboxLock(cfg.folder || "INBOX", { readOnly: true });
        try {
          const found = await client.search({ since: new Date(Date.now() - sinceDays * 86_400_000) }, { uid: true });
          const uids = (found || []).slice(-max);
          if (uids.length) {
            for await (const msg of client.fetch(uids, { source: true, internalDate: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed = await simpleParser(msg.source);
              // newsletters and mailing lists never carry a reply to an application
              // (a portal's own "your application was sent" receipt is transactional but often carries these headers: it is kept)
              if (!isApplicationReceipt(parsed.subject) && (parsed.headers.get("list-unsubscribe") || parsed.headers.get("list") || /bulk|list|junk/i.test(String(parsed.headers.get("precedence") ?? "")))) continue;
              const from = parsed.from?.text ?? "";
              if (from.toLowerCase().includes(cfg.user.toLowerCase())) continue;
              out.push({ from, subject: parsed.subject ?? "", text: (parsed.text ?? "").slice(0, 3000), date: parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : undefined), messageId: parsed.messageId });
            }
          }
        } finally { lock.release(); }
      } catch (e) {
        throw new Error(explainImapError(e, cfg));
      } finally {
        await client.logout().catch(() => client.close());
      }
      return out;
    },
  };
}

export type MailboxScan = { jobs: NormalizedJob[]; emails: number; withJobs: number; byPortal: Record<string, number> };

/** Fetch recent alert emails and extract their jobs. */
export async function scanMailbox(src: MailSource, o: { sinceDays: number; max?: number }): Promise<MailboxScan> {
  const mails = await src.fetchRecent({ sinceDays: o.sinceDays, max: o.max ?? 120 });
  const jobs: NormalizedJob[] = [];
  const byPortal: Record<string, number> = {};
  let withJobs = 0;
  for (const m of mails) {
    const found = parseAlertEmail(m);
    if (found.length) withJobs++;
    for (const j of found) { jobs.push(j); byPortal[j.publisher ?? "other"] = (byPortal[j.publisher ?? "other"] ?? 0) + 1; }
  }
  return { jobs, emails: mails.length, withJobs, byPortal };
}
