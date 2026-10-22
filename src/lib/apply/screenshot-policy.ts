/**
 * Which pictures of an application's page are still worth keeping. They fill the storage quickly (a full-page PNG can be a megabyte), and each has a short useful life:
 *  - live.jpg: the live view while the assistant works on it. Useless the moment it finishes.
 *  - last-state.png: where it stopped, for you to see while the application is waiting for you. Useless once it is sent or the job is closed.
 *  - confirmation.png: the employer's confirmation page after sending, kept as proof for a few days, then deleted (the confirmation text stays in the record).
 * Pure: the sweep in screenshot-store.ts and the workers call it.
 */
export type ShotStage = "working" | "all";

export const shotPaths = (appId: string) => ({
  live: `screenshots/${appId}/live.jpg`,
  last: `screenshots/${appId}/last-state.png`,
  proof: `screenshots/${appId}/confirmation.png`,
});

export const DEFAULT_PROOF_DAYS = 14;

export type ShotApp = { id: string; status: string; submitted_at: string | null };

/**
 * What to delete for one application now, or null for nothing.
 * `jobStatus` is the job's own status ("skipped" covers a closed posting and one you skipped); `done` is how far an earlier sweep got.
 */
export function planScreenshots(a: ShotApp, jobStatus: string | null, now: Date, proofDays: number, done: ShotStage | null): { stage: ShotStage; paths: string[] } | null {
  const p = shotPaths(a.id);
  if (done === "all") return null;
  if (jobStatus === "skipped") return { stage: "all", paths: [p.live, p.last, p.proof] };
  if (a.status === "submitted") {
    const sentAt = a.submitted_at ? new Date(a.submitted_at).getTime() : null;
    const aged = proofDays <= 0 || (sentAt !== null && now.getTime() - sentAt >= proofDays * 86_400_000);
    if (aged) return { stage: "all", paths: [p.live, p.last, p.proof] };
    if (done === "working") return null;
    return { stage: "working", paths: [p.live, p.last] };
  }
  return null;
}
