/** The stored master pause. `until` (an ISO time) makes it a timed pause that ends by itself; without it the pause lasts until switched off. */
export type PauseValue = { paused?: boolean; since?: string; until?: string; note?: string } | null | undefined;

export const pauseActive = (v: PauseValue, now: Date = new Date()): boolean => {
  if (v?.paused !== true) return false;
  if (!v.until) return true;
  const end = new Date(v.until).getTime();
  return Number.isNaN(end) ? true : now.getTime() < end;
};
