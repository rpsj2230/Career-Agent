import { parseAtsUrl } from "@/lib/jobs/ats";
import { isRedirector } from "@/lib/jobs/redirectors";

/**
 * Can an application for this job be sent by the assistant at all? Writing a resume costs AI tokens, so a job that can never be applied for automatically is left for
 * you to apply by hand and no resume is written for it. A job stays in your queue either way; this only decides whether the agent spends effort on it.
 *  - MyCareersFuture needs a Singpass sign-in, which nothing automated can do.
 *  - Adzuna, Jooble, Careerjet and Jobrapido links are the board's own listing page, which refuses the assistant's browser. The employer's own link is found only through
 *    Google for Jobs (a JSearch key on the Portals page), so without that key such a job has no route.
 * Pure.
 */
export function manualOnlyReason(job: { url?: string | null; portal?: string | null }, o: { jsearchKey: boolean }): string | null {
  const url = job.url ?? "";
  let host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch { /* no usable link */ }
  if (/(^|\.)mycareersfuture\.gov\.sg$/.test(host) || String(job.portal ?? "").toLowerCase() === "mycareersfuture") return "MyCareersFuture needs a Singpass sign-in, which the agent cannot do: apply on the site yourself";
  if (url && isRedirector(url) && !parseAtsUrl(url) && !o.jsearchKey) return "its link is a job board's listing page, which refuses the agent's browser, and no Google for Jobs key (JSearch, on the Portals page) is set to find the employer's own link: apply from the board yourself";
  return null;
}
