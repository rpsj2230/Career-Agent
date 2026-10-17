import "server-only";
import { htmlToText } from "./normalize";
import { guardedGet, type ResolveDeps } from "./resolve-url";

/**
 * Reading a job's own page: to fetch the full description when a source gave only a snippet, and to check that the role is
 * still open before an application is prepared. Job portals are never fetched this way (their terms forbid it): their listings come
 * from their own alerts, feeds or APIs. Employer sites and applicant-tracking pages are public and are read politely, one request each.
 */
const PORTAL_HOST = /(^|\.)(linkedin|indeed|glassdoor|naukri|naukrigulf|foundit|monsterindia|shine|instahyre|cutshort|wellfound|angel|internshala|timesjobs|apna|bayt|gulftalent|seek|jobstreet|jobsdb|mycareersfuture|ziprecruiter|jooble|careerjet|jobrapido|monster|simplyhired|reed|totaljobs|stepstone|xing)\.[a-z.]+$/i;

export const isReadablePage = (url: string): boolean => {
  try { const u = new URL(url); return (u.protocol === "https:" || u.protocol === "http:") && !PORTAL_HOST.test(u.hostname); } catch { return false; }
};

const decodeBasic = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

/** The job text of a page: the schema.org JobPosting description when there is one, otherwise the main content. Null if it is not a job page. */
export function extractJobText(html: string, minChars = 400): string | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown): string | null => {
        if (Array.isArray(n)) { for (const x of n) { const r = walk(x); if (r) return r; } return null; }
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          if (/JobPosting/i.test(String(o["@type"])) && typeof o.description === "string") return o.description;
          return walk(o["@graph"]);
        }
        return null;
      };
      const d = walk(JSON.parse(m[1]));
      if (d) { const t = htmlToText(decodeBasic(d)); if (t.length >= minChars) return t; }
    } catch { /* not valid JSON: try the next block */ }
  }
  const stripped = html.replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, " ");
  const main = stripped.match(/<(main|article)\b[\s\S]*?<\/\1>/i)?.[0] ?? stripped.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? stripped;
  const text = htmlToText(main);
  const jobish = /(responsibilit|requirement|qualification|experience|you will|about the (role|job|team)|what you)/i.test(text);
  return text.length >= minChars && jobish ? text : null;
}

/** The full description of a job from its own page, or null (not readable, blocked, or not a job page). */
export async function fetchJobText(url: string, deps?: ResolveDeps): Promise<string | null> {
  if (!isReadablePage(url)) return null;
  const r = await guardedGet(url, { deps, body: true, allow: isReadablePage });
  if (!r || r.status >= 400) return null;
  const t = extractJobText(r.text);
  return t ? t.slice(0, 12_000) : null;
}

const CLOSED_TEXT = /(no longer (accepting|available|open)|position (has been|is) filled|(job|role|position|posting|vacancy) (has )?(expired|closed|been removed)|this (job|position|posting) (is|has been) (closed|removed|unavailable)|sorry,? (this|the) (job|position)|applications? (are|is) (now )?closed|we('| a)re no longer)/i;

export type OpenCheck = { open: boolean | null; reason?: string };

/** Is the posting still there? null = cannot tell (portals, errors), which never blocks anything. */
export async function checkPostingOpen(url: string, deps?: ResolveDeps): Promise<OpenCheck> {
  if (!isReadablePage(url)) return { open: null };
  const r = await guardedGet(url, { deps, body: true, maxBytes: 150_000, allow: isReadablePage });
  if (!r) return { open: null };
  if (r.status === 404 || r.status === 410) return { open: false, reason: `The posting page returned ${r.status} (removed)` };
  if (r.status >= 400) return { open: null };
  const text = htmlToText(r.text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, 6000);
  if (CLOSED_TEXT.test(text.slice(0, 700))) return { open: false, reason: "The posting says it is no longer open" };
  return { open: true };
}
