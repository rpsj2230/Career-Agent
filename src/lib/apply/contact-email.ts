/**
 * Contact addresses found in a job posting. Applications are only ever emailed to an address that appears in the posting itself
 * (or one you type in yourself), never to a guessed one.
 */
export type ContactEmail = { email: string; score: number; why: string };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** "name [at] company [dot] com" is how many postings hide an address from bots */
const deobfuscate = (t: string) => t.replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@").replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");

const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|donotreply|noreply|unsubscribe|privacy|abuse|postmaster|webmaster|mailer-daemon|notifications?|alerts?|newsletter|support|help|billing|sales|marketing|press|legal|security|info-?noreply)$/i;
const JOB_SITES = /(^|\.)(example\.(com|org|net)|sentry\.io|wixpress\.com|adzuna\.[a-z.]+|indeed\.[a-z.]+|linkedin\.com|glassdoor\.[a-z.]+|naukri\.com|jooble\.[a-z.]+|ziprecruiter\.com|jobstreet\.[a-z.]+|seek\.com\.[a-z]+|monster\.[a-z.]+)$/i;
const FILE_LIKE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
const HIRING_WORDS = /(career|job|recruit|hiring|talent|hr|people|apply|application|resume|cv|vacanc|opening|join|staffing|human)/i;

export function extractContactEmails(text: string | null | undefined, company = ""): ContactEmail[] {
  const body = deobfuscate(text ?? "");
  const companyWords = company.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["pte", "ltd", "inc", "llc", "the", "and", "pvt", "limited", "private"].includes(w));
  const found = new Map<string, ContactEmail>();
  for (const m of body.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/[.,;:]+$/, "");
    const [local, domain] = email.split("@");
    if (!local || !domain || found.has(email) || FILE_LIKE.test(email) || NOT_A_PERSON.test(local) || JOB_SITES.test(domain)) continue;
    let score = 1;
    const why: string[] = [];
    if (HIRING_WORDS.test(local)) { score += 3; why.push("a hiring address"); }
    if (companyWords.some((w) => domain.includes(w))) { score += 2; why.push("the company's own domain"); }
    const before = body.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0).toLowerCase();
    if (/(send|email|e-mail|mail|submit|forward|apply|resume|cv)/.test(before)) { score += 2; why.push("asked for in the posting"); }
    found.set(email, { email, score, why: why.join(", ") || "listed in the posting" });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/** A mailto: link as the posting's apply link */
export const mailtoAddress = (url: string | null | undefined): string | null => {
  const m = /^mailto:([^?]+)/i.exec((url ?? "").trim());
  const a = m ? decodeURIComponent(m[1]).trim().toLowerCase() : null;
  return a && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : null;
};

/** All addresses for a job, best first: the apply link itself, then the ones found in the description. */
export function contactEmailsFor(job: { url?: string | null; description?: string | null; company?: string | null }): ContactEmail[] {
  const link = mailtoAddress(job.url);
  const found = extractContactEmails(job.description, job.company ?? "");
  return link ? [{ email: link, score: 99, why: "the posting's apply link" }, ...found.filter((f) => f.email !== link)] : found;
}
