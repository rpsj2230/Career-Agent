import type { ScheduleRow } from "./schedule";
import { describeSchedule } from "./schedule";

/** Non-secret summary of a schedule for the activity log. */
export const scheduleSummary = (s: ScheduleRow) => ({
  schedule_id: s.id, when: describeSchedule(s), enabled: s.enabled, paused: s.paused, mode: s.mode, require_approval: s.require_approval,
  countries: s.countries, integrations: s.integrations, max_prepare: s.max_prepare, max_apply: s.max_apply, next_run_at: s.next_run_at,
});
