/**
 * Autopilot: what the one switch sets, so the system finds, scores, writes, approves and sends without a person in the loop.
 * The numbers come from the largest values the settings accept, except LinkedIn, which stays lower because LinkedIn restricts accounts
 * that apply in bulk.
 */
export const AUTOPILOT = {
  caps: { daily_total: 100, daily_linkedin: 30, weekly_linkedin: 150, linkedin_automation_enabled: true, local_auto_enabled: true },
  autoPrepare: { enabled: true, per_run: 40, concurrency: 4 },
  schedule: { mode: "scan_prepare_apply" as const, require_approval: false, max_prepare: 40, max_apply: 100, frequency: "every_n_hours" as const, interval_hours: 6 },
  /** approvals of the already-prepared backlog per round, so one round stays inside its time budget */
  approvePerRound: 150,
} as const;

/** How many applications may still be approved for sending in this round: what is left of the day, and the schedule's own per-run limit. */
export const approvalsLeft = (dailyTotal: number, sentToday: number, maxApply: number): number => Math.max(0, Math.min(dailyTotal - sentToday, maxApply));
