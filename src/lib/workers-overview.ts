/** Who can apply, whether each worker is reporting in, and what it handles, for the Workers panel. */
export type Beat = { at?: string; portals?: string[] } | null | undefined;
export type WorkersInput = {
  now: Date;
  computer: Beat;
  oracle: Beat;
  github: Beat;
  cloud: { enabled: boolean; fallback_minutes: number };
  /** applications each worker started in the last 24 hours, and how many it passed on (a sign-in page, a security check) */
  started24h: Record<string, number>;
  declined24h: Record<string, number>;
};
export type WorkerRow = { id: "github" | "oracle" | "computer"; name: string; where: string; state: "working" | "idle" | "quiet" | "never" | "off"; seen: string; handles: string[]; started: number; passedOn: number };

const ago = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
const PORTAL_NAMES: Record<string, string> = { linkedin: "LinkedIn", indeed: "Indeed", naukri: "Naukri" };

export function workersOverview(i: WorkersInput): WorkerRow[] {
  // a worker that runs on a timer (GitHub) is "idle" between its runs, which GitHub spaces a few hours apart on a free account; only after idleMin is it "quiet"
  const status = (b: Beat, freshMin: number, offWhenCloudOff = false, idleMin = 0): Pick<WorkerRow, "state" | "seen"> => {
    if (offWhenCloudOff && !i.cloud.enabled) return { state: "off", seen: b?.at ? `last seen ${ago(i.now.getTime() - new Date(b.at).getTime())}` : "never seen" };
    if (!b?.at) return { state: "never", seen: "never seen" };
    const age = i.now.getTime() - new Date(b.at).getTime();
    return { state: age <= freshMin * 60_000 ? "working" : age <= idleMin * 60_000 ? "idle" : "quiet", seen: `last seen ${ago(age)}` };
  };
  const oraclePortals = (i.oracle?.portals ?? []).map((p) => PORTAL_NAMES[p] ?? p);
  const oracleAlive = status(i.oracle, 10).state === "working";
  const n = (r: Record<string, number>, k: string) => r[k] ?? 0;
  return [
    { id: "github", name: "GitHub (free cloud runner)", where: "runs every hour, nothing to keep switched on", ...status(i.github, 75, true, 8 * 60), handles: i.cloud.enabled ? ["Employers' own pages"] : ["Nothing while cloud workers are off"], started: n(i.started24h, "github"), passedOn: n(i.declined24h, "github") },
    { id: "oracle", name: "Always-on machine (for example Oracle)", where: "optional; you set it up once", ...status(i.oracle, 10, true), handles: i.cloud.enabled ? ["Employers' own pages", ...oraclePortals] : ["Nothing while cloud workers are off"], started: n(i.started24h, "oracle"), passedOn: n(i.declined24h, "oracle") },
    {
      id: "computer", name: "Your computer (the assistant)", where: "needs the computer on and you signed in", ...status(i.computer, 3),
      handles: [
        ...["LinkedIn", "Indeed", "Naukri"].filter((p) => !oracleAlive || !oraclePortals.includes(p)),
        ...(oracleAlive && oraclePortals.length ? [`${oraclePortals.join(", ")} only if the always-on machine passes them on or stops`] : []),
        i.cloud.enabled ? `Employers' own pages that wait more than ${i.cloud.fallback_minutes} minutes for the cloud workers` : "Employers' own pages",
      ],
      started: n(i.started24h, "computer"), passedOn: 0,
    },
  ];
}
