import nodemailer from "nodemailer";

export type SmtpConfig = { host: string; port: number; user: string; password: string };

/** Sending uses the same mailbox you connected for reading job alerts: imap.gmail.com becomes smtp.gmail.com on port 465. */
export function smtpFromMailbox(m: { host: string; user: string; password: string } | undefined, env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  if (env.SMTP_HOST?.trim() && env.SMTP_USER?.trim() && env.SMTP_PASSWORD) return { host: env.SMTP_HOST.trim(), port: Number(env.SMTP_PORT) || 465, user: env.SMTP_USER.trim(), password: env.SMTP_PASSWORD };
  if (!m?.host || !m.user || !m.password) return null;
  return { host: m.host.replace(/^imap(-mail)?\./i, "smtp."), port: 465, user: m.user, password: m.password };
}

type Transport = { sendMail(o: Record<string, unknown>): Promise<unknown> };

/** Sends one plain-text email. Returns null on success, or a short reason that can be shown to you. Never throws. */
export async function sendEmail(cfg: SmtpConfig | null, o: { to: string; subject: string; text: string; html?: string }, make: (c: SmtpConfig) => Transport = (c) => nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.password }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 })): Promise<string | null> {
  if (!cfg) return "Email is not set up: connect your mailbox on the Job sources page (the same Gmail app password is used to send).";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.to)) return `"${o.to}" is not an email address.`;
  try {
    await make(cfg).sendMail({ from: `Career Agent <${cfg.user}>`, to: o.to, subject: o.subject, text: o.text, ...(o.html ? { html: o.html } : {}) });
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return /Invalid login|Username and Password not accepted|535/i.test(m) ? "The mailbox login was refused: use a Gmail app password (not your normal password)." : /ENOTFOUND|EAI_AGAIN/.test(m) ? `Could not find the mail server "${cfg.host}".` : `Could not send: ${m.slice(0, 200)}`;
  }
}
