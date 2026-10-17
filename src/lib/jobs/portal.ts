/**
 * Which portal a job listing LIVES on (its origin), as opposed to which integration fetched it.
 * The SQL backfill in supabase/migrations/0002_*.sql mirrors `portalFromUrl`; a test keeps them identical.
 */

/** [portal key, hostname pattern]. Order matters: first match wins. */
// Real country endings only (.com, .in, .co.uk, .com.sg), so "indeed.evil.com" is not Indeed.
const TLD = "(com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2})";

export const PORTAL_HOSTS: [string, RegExp][] = [
  ["linkedin", /(^|\.)linkedin\.com$/],
  ["indeed", new RegExp(`(^|\\.)indeed\\.${TLD}$`)],
  ["glassdoor", new RegExp(`(^|\\.)glassdoor\\.${TLD}$`)],
  ["naukri", /(^|\.)naukri\.com$/],
  ["foundit", new RegExp(`(^|\\.)(foundit\\.${TLD}|monsterindia\\.com)$`)],
  ["shine", /(^|\.)shine\.com$/],
  ["instahyre", /(^|\.)instahyre\.com$/],
  ["cutshort", /(^|\.)cutshort\.io$/],
  ["wellfound", /(^|\.)(wellfound\.com|angel\.co)$/],
  ["internshala", /(^|\.)internshala\.com$/],
  ["timesjobs", /(^|\.)timesjobs\.com$/],
  ["apna", /(^|\.)apna\.co$/],
  ["greenhouse", /(^|\.)greenhouse\.io$/],
  ["lever", /(^|\.)lever\.co$/],
  ["remotive", /(^|\.)remotive\.(com|io)$/],
];

/** Lower-case slug used for portal keys, e.g. "ZipRecruiter" -> "ziprecruiter". */
export const portalSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);

export function portalFromUrl(url: string): string | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  return PORTAL_HOSTS.find(([, re]) => re.test(host))?.[0] ?? null;
}

/**
 * Origin portal for a job. A publisher named by an aggregator (JSearch's job_publisher) is the most reliable
 * statement of where the posting lives; otherwise the posting URL's host; otherwise the integration that
 * supplied it (the aggregator itself, e.g. "adzuna").
 */
export function detectPortal(input: { url: string; publisher?: string | null; integration: string }): string {
  const pub = input.publisher ? portalSlug(input.publisher) : "";
  if (pub) {
    // normalise common publisher spellings to our keys ("Naukri.com" -> "naukri")
    if (pub in PORTAL_LABELS) return pub; // a portal we know by name ("naukrigulf" is not "naukri")
    const hit = PORTAL_HOSTS.find(([key]) => pub.startsWith(key))?.[0];
    return hit ?? pub;
  }
  return portalFromUrl(input.url) ?? input.integration.split(":")[0];
}

/** Display names for the portals we know; unknown keys are shown as-is with a capital. */
export const PORTAL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor", naukri: "Naukri", foundit: "Foundit", shine: "Shine",
  instahyre: "Instahyre", cutshort: "Cutshort", wellfound: "Wellfound", internshala: "Internshala", timesjobs: "TimesJobs", apna: "Apna",
  greenhouse: "Greenhouse (company)", lever: "Lever (company)", remotive: "Remotive", arbeitnow: "Arbeitnow", remoteok: "Remote OK", jobicy: "Jobicy", adzuna: "Adzuna", jsearch: "JSearch", manual: "Added manually",
  ziprecruiter: "ZipRecruiter", bayt: "Bayt", naukrigulf: "Naukrigulf", gulftalent: "GulfTalent", seek: "SEEK", jobstreet: "JobStreet", jobsdb: "JobsDB", mycareersfuture: "MyCareersFuture", mcf: "MyCareersFuture", mailbox: "Alert emails",
};
export const portalLabel = (key: string | null | undefined) => (key ? PORTAL_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
