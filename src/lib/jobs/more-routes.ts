import { parseAtsUrl, type Ats } from "./ats";
import { findOnBoards, placesAgree, titleSimilarity, type Direct } from "./alt-routes";

/** A way in: an applicant-tracking form (`ats` set) or an employer's own page ("none"). */
export type Found = Omit<Direct, "ats"> & { ats: Ats | "none" };
import { isRedirector } from "./redirectors";

/**
 * More ways to reach an employer's own application form, for a job whose board link goes nowhere. Each is tried only after the ones before it fail
 * (see `RouteId` for the order). Everything here is read from public pages the employer or Google publishes; nothing is guessed loosely:
 * a page is only believed to be the employer's when it names the company, and a posting only when its title matches closely.
 * Pure apart from the fetchers the caller supplies, so tests never touch the network.
 */
export type RouteId = "board-link" | "description-link" | "employer-board" | "careers-site" | "google-jobs" | "email";

export const ROUTE_LABEL: Record<RouteId, string> = {
  "board-link": "the job board's own Apply link",
  "description-link": "a link named in the job description",
  "employer-board": "the same job on the employer's Greenhouse, Lever, Ashby, Workable or Recruitee board",
  "careers-site": "the employer's own careers page",
  "google-jobs": "the direct link Google for Jobs lists for the same job",
  email: "an email application to an address in the posting",
};

export type MoreDeps = {
  getJson(url: string): Promise<unknown | null>;
  getHtml(url: string): Promise<string | null>;
};
export type JobFacts = { title: string; company: string; location?: string | null; description?: string | null; url?: string | null };

/** Sites that are never an employer's own: job boards, social networks, mail, search. */
const NOT_EMPLOYER = /(^|\.)(linkedin|indeed|glassdoor|naukri|foundit|shine|monster|ziprecruiter|jooble|careerjet|jobrapido|adzuna|seek|jobstreet|jobsdb|bayt|naukrigulf|gulftalent|simplyhired|talent|lensa|learn4good|google|facebook|instagram|twitter|x|youtube|tiktok|wa|t|bit|goo|tinyurl|lnkd|gmail|yahoo|outlook|hotmail|icloud|proton|protonmail|aol|gstatic|googleapis|w3|schema|apple|microsoft|github|wikipedia)\.[a-z.]+$/i;
const FREE_MAIL = /^(gmail|yahoo|outlook|hotmail|icloud|proton|protonmail|aol|live|msn|rediffmail|zoho)\./i;

const hostOf = (u: string): string | null => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
/** The registrable-ish name of a host ("jobs.acme.co.uk" to "acme.co.uk"), good enough to compare two links of one employer. */
const base = (h: string) => { const p = h.split("."); return p.length <= 2 ? h : /^(co|com|org|net|gov|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join(".") : p.slice(-2).join("."); };

const wordsOf = (company: string) => company.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["pty", "ltd", "inc", "llc", "llp", "plc", "the", "and", "pte", "pvt", "limited", "private", "corp", "group", "company"].includes(w));
/** Does this text plausibly belong to the company? True only when its first distinctive word appears. */
export const mentionsCompany = (text: string, company: string): boolean => { const w = wordsOf(company); return w.length > 0 && text.toLowerCase().includes(w[0]); };

export type LdPosting = { employerSites: string[]; applyUrls: string[]; directApply: boolean };
/** What a job page says about itself in its structured data (schema.org JobPosting): who the employer is and where to apply. */
export function readJobPostingLd(html: string): LdPosting {
  const out: LdPosting = { employerSites: [], applyUrls: [], directApply: false };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) { stack.push(...n); continue; }
      if (!n || typeof n !== "object") continue;
      const o = n as Record<string, unknown>;
      if (o["@graph"]) stack.push(o["@graph"]);
      const type = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
      if (!type.includes("JobPosting")) continue;
      if (o.directApply === true || o.directApply === "true") out.directApply = true;
      for (const u of ([] as unknown[]).concat(o.url ?? [], o.applicationContact && typeof o.applicationContact === "object" ? (o.applicationContact as Record<string, unknown>).url ?? [] : [])) if (typeof u === "string") out.applyUrls.push(u);
      const org = o.hiringOrganization;
      for (const one of ([] as unknown[]).concat(org ?? [])) {
        if (!one || typeof one !== "object") continue;
        const r = one as Record<string, unknown>;
        for (const u of ([] as unknown[]).concat(r.sameAs ?? [], r.url ?? [])) if (typeof u === "string" && /^https?:/.test(u)) out.employerSites.push(u);
      }
    }
  }
  return out;
}

/** The employer's own domains, best first: named in the job page's data, then links in the description, then the domain of a hiring email address. */
export function employerSites(job: JobFacts, ld: LdPosting | null): string[] {
  const found: string[] = [];
  const add = (u: string) => { const h = hostOf(u); if (h && !NOT_EMPLOYER.test(h) && !isRedirector(u) && !parseAtsUrl(u)) found.push(`https://${h}`); };
  for (const u of ld?.employerSites ?? []) add(u);
  for (const m of (job.description ?? "").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) add(m[0].replace(/[.,;:]+$/, ""));
  for (const m of (job.description ?? "").matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) { const d = m[1].toLowerCase(); if (!FREE_MAIL.test(d) && !NOT_EMPLOYER.test(d) && mentionsCompany(d, job.company)) add(`https://${d}`); }
  const seen = new Set<string>();
  return found.filter((u) => { const b = base(hostOf(u)!); if (seen.has(b)) return false; seen.add(b); return true; }).slice(0, 3);
}

const CAREER_PATHS = ["/careers", "/jobs", "/careers/", "/join-us", "/work-with-us", "/about/careers", "/company/careers"];

export type Link = { href: string; text: string };
const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export function linksIn(html: string, pageUrl: string): Link[] {
  const out: Link[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try { href = new URL(m[1].replace(/&amp;/g, "&"), pageUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(href)) continue;
    out.push({ href, text: stripTags(m[2]) });
  }
  return out;
}

/**
 * The employer's own careers page. Its public pages are read for (a) links to an applicant-tracking board, whose job list is then read by name
 * rather than guessed, and (b) a link whose text is this job's title. Only pages that name the company are trusted.
 */
export async function careersSiteRoutes(job: JobFacts, deps: MoreDeps, listingHtml?: string | null): Promise<Found[]> {
  const ld = listingHtml ? readJobPostingLd(listingHtml) : null;
  const direct: Found[] = [];
  for (const u of ld?.applyUrls ?? []) { const a = parseAtsUrl(u); if (a && !isRedirector(u)) direct.push({ url: u, ats: a.ats, how: `the application page named in the job page's own data (${a.ats})` }); }
  const boards: { ats: Ats; slug: string }[] = [];
  for (const site of employerSites(job, ld)) {
    for (const path of CAREER_PATHS) {
      const pageUrl = `${site}${path}`;
      const html = await deps.getHtml(pageUrl).catch(() => null);
      if (!html || !mentionsCompany(stripTags(html), job.company)) continue;
      for (const l of linksIn(html, pageUrl)) {
        const a = parseAtsUrl(l.href);
        if (a) { boards.push({ ats: a.ats, slug: a.board }); continue; }
        const sameSite = hostOf(l.href) && base(hostOf(l.href)!) === base(hostOf(site)!);
        if (sameSite && l.text && titleSimilarity(job.title, l.text) >= 0.85) direct.push({ url: l.href, ats: "none", how: `the job listed on the employer's careers page (${hostOf(site)})` });
      }
      break; // the first careers page that exists and names the company is the one to read
    }
  }
  const viaBoard = boards.length ? await findOnBoards(job, boards, { getJson: deps.getJson }, "the careers page's") : null;
  const all = [...(viaBoard ? [viaBoard] : []), ...direct];
  return [...new Map(all.map((d) => [d.url, d])).values()];
}

/** JSearch (Google for Jobs) lists, for one posting, every place it can be applied; the employer's own link is marked direct. */
type ApplyOption = { publisher?: string; apply_link?: string; is_direct?: boolean };
export async function googleJobsRoutes(job: JobFacts, search: (q: URLSearchParams) => Promise<unknown[]>): Promise<Found[]> {
  const rows = await search(new URLSearchParams({ query: [job.title, job.company, job.location].filter(Boolean).join(" "), num_pages: "1" })).catch(() => [] as unknown[]);
  const out: Found[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const employer = String(r.employer_name ?? "");
    if (!mentionsCompany(employer, job.company) && !mentionsCompany(job.company, employer)) continue;
    if (titleSimilarity(job.title, String(r.job_title ?? "")) < 0.85) continue;
    const where = [r.job_city, r.job_state, r.job_country].filter(Boolean).join(" ");
    if (!placesAgree(job.location, where)) continue;
    const options: ApplyOption[] = [...(Array.isArray(r.apply_options) ? (r.apply_options as ApplyOption[]) : []), ...(typeof r.job_apply_link === "string" ? [{ apply_link: r.job_apply_link, is_direct: r.job_apply_is_direct === true }] : [])];
    for (const o of options.sort((a, b) => Number(!!b.is_direct) - Number(!!a.is_direct))) {
      const url = o.apply_link;
      if (!url || !/^https?:/.test(url) || isRedirector(url)) continue;
      const h = hostOf(url);
      if (!h || (NOT_EMPLOYER.test(h) && !o.is_direct)) continue; // another job board is no better than the one we came from
      const a = parseAtsUrl(url);
      out.push({ url, ats: a?.ats ?? "none", how: `the ${o.is_direct ? "direct " : ""}application link Google for Jobs lists${o.publisher ? ` (${o.publisher})` : ""}` });
    }
  }
  return [...new Map(out.map((d) => [d.url, d])).values()].slice(0, 4);
}
