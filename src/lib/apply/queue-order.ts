import { parseAtsUrl } from "@/lib/jobs/ats";
import { isRedirector } from "@/lib/jobs/redirectors";

/**
 * The order the assistant works through its queue. A round only takes a few dozen applications, so what comes first decides what gets done:
 *  0  the sign-in portals the assistant is built for (LinkedIn, Naukri, Indeed) and employer application systems (Greenhouse, Lever, ...);
 *  1  other employer pages;
 *  2  job-board listings that send you on to the employer (Adzuna and the like), which refuse an automated browser, and portals that need a
 *     national sign-in the assistant does not have (MyCareersFuture): last, so they never use up a round ahead of jobs that can be applied for.
 * Within a group the oldest approval goes first.
 */
export type QueueJob = { url?: string | null; portal?: string | null; apply_type?: string | null };
export function queuePriority(j: QueueJob): 0 | 1 | 2 {
  const portal = String(j.portal ?? "").toLowerCase();
  const url = j.url ?? "";
  if (/^(linkedin|naukri|indeed)$/.test(portal)) return 0;
  if (url && parseAtsUrl(url)) return 0;
  if (j.apply_type === "greenhouse" || j.apply_type === "lever") return 0;
  if ((url && isRedirector(url)) || /^(adzuna|jooble|careerjet|jobrapido|mycareersfuture)$/.test(portal)) return 2;
  return 1;
}

export function orderQueue<T extends { approved_at?: string | null }>(items: T[], jobOf: (item: T) => QueueJob | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, p: queuePriority(jobOf(item) ?? {}) }))
    .sort((a, b) => a.p - b.p || String(a.item.approved_at ?? "").localeCompare(String(b.item.approved_at ?? "")) || a.i - b.i)
    .map((x) => x.item);
}
