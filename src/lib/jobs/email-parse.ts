import { guessCountry, htmlToText, plainField, type NormalizedJob } from "./normalize";

export type AlertMail = { from: string; subject: string; html: string; text?: string; date?: Date; messageId?: string };

type Match = { id: string; url: string; /** when one parser serves several portals */ portal?: string };
type PortalParser = { portal: string; senders: string[]; match: (u: URL) => Match | null };

const hostIs = (u: URL, ...suffixes: string[]) => suffixes.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

/**
 * One parser per portal. A link only counts when the email came from that portal's own domain AND the link points
 * at that portal, so a forwarded or spoofed message cannot inject arbitrary links as jobs.
 */
const PARSERS: PortalParser[] = [
  {
    portal: "linkedin", senders: ["linkedin.com"],
    match: (u) => {
      if (!hostIs(u, "linkedin.com")) return null;
      const m = u.pathname.match(/\/(?:comm\/)?jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
      return m ? { id: m[1], url: `https://www.linkedin.com/jobs/view/${m[1]}` } : null;
    },
  },
  {
    portal: "indeed", senders: ["indeed.com", "indeedemail.com"],
    match: (u) => {
      if (!/(^|\.)indeed\.[a-z.]+$/.test(u.hostname)) return null;
      const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
      return jk && /^[0-9a-f]{8,}$/i.test(jk) ? { id: jk, url: `https://${u.hostname.replace(/^(cts|alert|m)\./, "www.")}/viewjob?jk=${jk}` } : null;
    },
  },
  {
    portal: "glassdoor", senders: ["glassdoor.com"],
    match: (u) => {
      if (!/(^|\.)glassdoor\.[a-z.]+$/.test(u.hostname)) return null;
      if (!/(job-listing|jobListing|\/Job\/)/.test(u.pathname)) return null;
      const id = u.searchParams.get("jl") ?? u.searchParams.get("jobListingId") ?? hash(u.pathname);
      return { id, url: `${u.origin}${u.pathname}${u.searchParams.get("jl") ? `?jl=${u.searchParams.get("jl")}` : ""}` };
    },
  },
  {
    portal: "naukri", senders: ["naukri.com"],
    match: (u) => {
      if (!hostIs(u, "naukri.com")) return null;
      const m = u.pathname.match(/job-listings-.*?-(\d{6,})\/?$/) ?? u.pathname.match(/job-listings-.*?(\d{6,})/);
      return m ? { id: m[1], url: `https://www.naukri.com${u.pathname}` } : null;
    },
  },
  {
    portal: "foundit", senders: ["foundit.in", "foundit.com", "monsterindia.com", "foundit.sg", "foundit.ae"],
    match: (u) => {
      if (!/(^|\.)(foundit\.[a-z.]+|monsterindia\.com)$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/job\/.*?-(\d{5,})\/?$/) ?? u.pathname.match(/\/job\/(\d{5,})/);
      return m ? { id: m[1], url: `${u.origin}${u.pathname}` } : null;
    },
  },
  {
    portal: "shine", senders: ["shine.com"],
    match: (u) => {
      if (!hostIs(u, "shine.com")) return null;
      const m = u.pathname.match(/\/jobs\/.*?\/(\d{5,})\/?$/) ?? u.pathname.match(/-(\d{6,})\/?$/);
      return m ? { id: m[1], url: `${u.origin}${u.pathname}` } : null;
    },
  },
  {
    portal: "bayt", senders: ["bayt.com"],
    match: (u) => {
      if (!hostIs(u, "bayt.com")) return null;
      const m = u.pathname.match(/\/jobs\/.*?-(\d{5,})\/?$/);
      return m ? { id: m[1], url: `${u.origin}${u.pathname}` } : null;
    },
  },
  {
    portal: "naukrigulf", senders: ["naukrigulf.com"],
    match: (u) => {
      if (!hostIs(u, "naukrigulf.com")) return null;
      const m = u.pathname.match(/-jid-(\d{5,})/) ?? u.pathname.match(/-(\d{8,})\/?$/);
      return m ? { id: m[1], url: `${u.origin}${u.pathname}` } : null;
    },
  },
  {
    portal: "gulftalent", senders: ["gulftalent.com"],
    match: (u) => {
      if (!hostIs(u, "gulftalent.com")) return null;
      const m = u.pathname.match(/\/jobs\/.*?-(\d{4,})\/?$/);
      return m ? { id: m[1], url: `${u.origin}${u.pathname}` } : null;
    },
  },
  {
    // SEEK (Australia, New Zealand), JobStreet (Singapore, Malaysia, Philippines, Indonesia) and JobsDB (Hong Kong, Thailand) share one platform
    portal: "seek", senders: ["seek.com.au", "seek.co.nz", "seek.com", "jobstreet.com", "jobsdb.com"],
    match: (u) => {
      if (!/(^|\.)(seek\.(com(\.au)?|co\.nz)|jobstreet\.com|jobsdb\.com)$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/job\/(\d{6,})/);
      return m ? { id: m[1], url: `${u.origin}/job/${m[1]}`, portal: /jobstreet/.test(u.hostname) ? "jobstreet" : /jobsdb/.test(u.hostname) ? "jobsdb" : "seek" } : null;
    },
  },
];

export function senderPortal(from: string): PortalParser | null {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = addr.split("@")[1] ?? "";
  return PARSERS.find((p) => p.senders.some((s) => domain === s || domain.endsWith(`.${s}`))) ?? null;
}
export const isAlertSender = (from: string) => senderPortal(from) !== null;
export const ALERT_SENDER_DOMAINS = PARSERS.flatMap((p) => p.senders);

const GENERIC_LINK_TEXT = /^(view|apply|see|see more jobs|open|easy apply|view job|view all|see all|unsubscribe|manage|learn more|edit|more|jobs?|click here|here|\d+)$/i;

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#38;/g, "&");
const tidy = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();

/** Portals email a receipt when you apply ("Your application was sent to Acme"); the job in it is already applied for. */
export const isApplicationReceipt = (subject: string | undefined): boolean => /\b(your application (was|has been) (sent|submitted|received)|you applied|application (sent|submitted)|thanks? for applying|thank you for applying)\b/i.test(subject ?? "");

/** Company and location from the text that follows a job title in the email ("Acme · Singapore", or two lines). */
export function contextOf(after: string): { company?: string; location?: string; salary?: string } {
  const parts = after
    .split(/\n|·|•|\||·/).map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && p.length < 90 && !GENERIC_LINK_TEXT.test(p) && !/^(new|actively recruiting|easily apply|promoted|be an early applicant|\d+ (applicants?|connections?|school alumni))/i.test(p));
  const salary = parts.find((p) => /(\$|£|€|₹|S\$|SGD|INR|USD|GBP|LPA|lakhs?|lacs?|per (year|month|hour)|\/ ?(yr|mo|hr))/i.test(p) && /\d/.test(p));
  const rest = parts.filter((p) => p !== salary);
  // Indeed writes "Company - Location" on one line
  const dash = rest[0]?.match(/^(.+?)\s+-\s+(.+)$/);
  if (dash) return { company: dash[1], location: dash[2], salary };
  return { company: rest[0], location: rest[1], salary };
}

/**
 * Extract the jobs listed in a job-alert email. Returns nothing for senders that are not a known portal.
 * Alert emails carry only a title, company, location and sometimes pay, never the full description: the description
 * field says so, and the job page lets you paste the real one before applying.
 */
export function parseAlertEmail(mail: AlertMail): NormalizedJob[] {
  const parser = senderPortal(mail.from);
  if (!parser || !mail.html) return [];
  if (isApplicationReceipt(mail.subject)) return []; // "Your application was sent to ...": a job you already applied for, not a new one to apply for
  const anchors: { href: string; text: string; start: number; end: number }[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(mail.html); m; m = re.exec(mail.html)) anchors.push({ href: decode(m[1]), text: tidy(m[2]), start: m.index, end: m.index + m[0].length });

  const found = new Map<string, { match: Match; title: string; start: number; end: number }>();
  for (const a of anchors) {
    let u: URL;
    try { u = new URL(a.href); } catch { continue; }
    const match = parser.match(u);
    if (!match) continue;
    const meaningful = a.text.length >= 3 && !GENERIC_LINK_TEXT.test(a.text);
    const cur = found.get(match.id);
    if (!cur) found.set(match.id, { match, title: meaningful ? a.text : "", start: a.start, end: a.end });
    else if (meaningful && (!cur.title || a.text.length > cur.title.length)) { cur.title = a.text; cur.start = a.start; cur.end = a.end; }
  }

  const ordered = [...found.values()].filter((f) => f.title).sort((x, y) => x.start - y.start);
  const jobs: NormalizedJob[] = [];
  ordered.forEach((f, i) => {
    const nextStart = ordered[i + 1]?.start ?? Math.min(mail.html.length, f.end + 1500);
    const ctx = contextOf(htmlToText(mail.html.slice(f.end, Math.min(nextStart, f.end + 1500)).replace(/<\/(p|div|tr|li|td|h\d)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")));
    const company = plainField(ctx.company) || "Unknown";
    const location = plainField(ctx.location) || undefined;
    jobs.push({
      source: "mailbox", externalId: `${f.match.portal ?? parser.portal}-${f.match.id}`, title: f.title.slice(0, 200), company: company.slice(0, 200),
      country: guessCountry(location ?? mail.subject), location, url: f.match.url, publisher: f.match.portal ?? parser.portal,
      description: `${f.title} at ${company}${location ? `, ${location}` : ""}. Found in a ${parser.portal} job-alert email ("${mail.subject.slice(0, 120)}"). Only this summary was in the email; open the posting for the full description.`,
      salaryText: ctx.salary, postedAt: mail.date?.toISOString(),
    });
  });
  return jobs;
}
