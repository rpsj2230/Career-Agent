/**
 * ASSIST_SKIP=naukri,shine: portals the assistant leaves alone because you apply to them by hand. Their applications stay waiting in the app.
 * The word "employer" stands for every employer's own page (a site that is not a known portal and needs no sign-in); those can be applied
 * for by the cloud assistant instead, so the assistant on your computer leaves them when the cloud one is switched on.
 */
export const skipPortals = (raw: string | undefined): string[] => (raw ?? "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

type Job = { portal?: string | null; source?: string | null; apply_type?: string | null };
const isEmployerSite = (job: Job) => job.apply_type === "unknown";
const matches = (token: string, job: Job) => (token === "employer" ? isEmployerSite(job) : [job.portal, job.source].some((v) => (v ?? "").toLowerCase().includes(token)));

export const isSkipped = (skip: string[], job: Job): boolean => skip.some((s) => matches(s, job));

/** With ASSIST_ONLY set (the cloud assistant: "employer"), only matching jobs are worked on. */
export const isWanted = (only: string[], job: Job): boolean => only.length === 0 || only.some((s) => matches(s, job));

export type Takeable = { skip: string[]; only: string[]; /** pages that another worker gets first, as tokens like "employer" */ defer: string[]; deferMs: number; now: number };

/**
 * May this worker take this application now? Skipped portals never; with ASSIST_ONLY only the matching ones; and pages in the defer list
 * only once they have waited `deferMs`, which is how work moves to the next worker when the first one is down or busy.
 */
export function takeable(job: Job, approvedAt: string | null, t: Takeable): boolean {
  if (isSkipped(t.skip, job) || !isWanted(t.only, job)) return false;
  if (t.defer.length && t.defer.some((d) => matches(d, job))) {
    const waited = approvedAt ? t.now - new Date(approvedAt).getTime() : Infinity;
    return waited >= t.deferMs;
  }
  return true;
}
