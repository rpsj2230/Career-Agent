/**
 * When the browser extension may press Submit by itself, and which waiting applications it may take. Pure.
 * It follows the same rules as the Mac assistant's hands-free mode: the Auto-Apply master switch, the pause switch and the daily limit.
 */
export type AutoState = { allowed: boolean; remainingToday: number; why: string | null };

export function decideAuto(o: { enabled: boolean; paused: boolean; dailyTotal: number; submittedToday: number }): AutoState {
  const remaining = Math.max(0, o.dailyTotal - o.submittedToday);
  if (!o.enabled) return { allowed: false, remainingToday: remaining, why: "Auto-Apply is switched off in Career Agent (Settings). The extension fills forms but will not submit them." };
  if (o.paused) return { allowed: false, remainingToday: remaining, why: "Everything is paused in Career Agent (Settings)." };
  if (remaining === 0) return { allowed: false, remainingToday: 0, why: `Today's limit of ${o.dailyTotal} applications is used up.` };
  return { allowed: true, remainingToday: remaining, why: null };
}

/** Applications the extension may take over by itself: the ones the assistant has already given up on or that wait for an answer. Optionally also those still waiting for the assistant. */
export const TAKEOVER_STATUSES = ["needs_input", "failed"] as const;
export const CLAIMABLE_STATUSES = ["needs_input", "failed", "assisted_pending"] as const;
