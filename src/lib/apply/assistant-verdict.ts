/** Is the apply assistant on your computer doing its job? Pure, so the rules are testable. */
export type Heartbeat = { at: string; mode?: "assist" | "hands-free"; watching?: boolean; hours?: string; tz?: string; round?: { at: string; submitted: number; handedBack: number; left: Record<string, number> } };
export type Verdict = { relevant: boolean; offline: boolean; waiting: number; text: string };

const inHours = (spec: string | undefined, hour: number | null): boolean => {
  const m = spec?.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m || hour === null) return true;
  const from = Number(m[1]), to = Number(m[2]);
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
};

const ago = (ms: number) => { const h = Math.floor(ms / 3_600_000); return h < 1 ? `${Math.max(1, Math.floor(ms / 60_000))} minutes` : h < 48 ? `${h} hours` : `${Math.floor(h / 24)} days`; };

export function assistantVerdict(i: { handsFree: boolean; waiting: number; oldestWaiting: string | null; heartbeat: Heartbeat | null; now: Date; localHour: number | null; offlineHours?: number }): Verdict {
  const limit = (i.offlineHours ?? 3) * 3_600_000;
  const seenMs = i.heartbeat ? i.now.getTime() - new Date(i.heartbeat.at).getTime() : null;
  const seen = seenMs === null ? "has never reported in" : `was last seen ${ago(seenMs)} ago`;
  if (i.waiting === 0 && !i.heartbeat) return { relevant: false, offline: false, waiting: 0, text: "" };
  if (i.waiting === 0) return { relevant: true, offline: false, waiting: 0, text: `The apply assistant ${seen}; nothing is waiting for it.` };
  const waitedMs = i.oldestWaiting ? i.now.getTime() - new Date(i.oldestWaiting).getTime() : 0;
  // quiet when it is outside the working hours you gave it, or when the application only just arrived
  const sleeping = i.heartbeat?.hours ? !inHours(i.heartbeat.hours, i.localHour) : false;
  const stale = seenMs === null ? waitedMs > limit : seenMs > limit;
  const offline = stale && waitedMs > limit && !sleeping && (i.handsFree || !!i.heartbeat?.watching);
  const text = `${i.waiting} application${i.waiting === 1 ? " is" : "s are"} waiting for the apply assistant on your computer, which ${seen}.${offline ? " Start it with npm run assist:watch (or open Applications to submit by hand)." : ""}`;
  return { relevant: true, offline, waiting: i.waiting, text };
}
