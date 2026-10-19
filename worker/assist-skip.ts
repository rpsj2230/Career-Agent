/** ASSIST_SKIP=naukri,shine: portals the assistant leaves alone because you apply to them by hand. Their applications stay waiting in the app. */
export const skipPortals = (raw: string | undefined): string[] => (raw ?? "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

export const isSkipped = (skip: string[], job: { portal?: string | null; source?: string | null }): boolean =>
  skip.some((s) => [job.portal, job.source].some((v) => (v ?? "").toLowerCase().includes(s)));
