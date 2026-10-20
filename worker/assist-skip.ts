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
