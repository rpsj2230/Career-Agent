import { DateTime } from "luxon";
import { z } from "zod";
import { isValidZone } from "./time";

export const FREQUENCIES = ["daily", "weekdays", "weekly", "every_n_hours"] as const;
export const SCHEDULE_MODES = ["scan", "scan_prepare", "scan_prepare_apply"] as const;
export const FREQUENCY_LABEL: Record<(typeof FREQUENCIES)[number], string> = {
  daily: "Every day", weekdays: "Weekdays (Mon to Fri)", weekly: "Selected days of the week", every_n_hours: "Every few hours",
};
export const MODE_LABEL: Record<(typeof SCHEDULE_MODES)[number], string> = {
  scan: "Find and score jobs only",
  scan_prepare: "Find, score, and prepare applications for my approval",
  scan_prepare_apply: "Find, score, prepare, and apply",
};
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const codes = z.array(z.string().regex(/^[a-z]{2}$/)).max(30).default([]);
const names = z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(20).default([]);

export const ScheduleInput = z
  .object({
    name: z.string().trim().min(1, "Give the schedule a name").max(80),
    enabled: z.boolean().default(true),
    frequency: z.enum(FREQUENCIES).default("daily"),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    interval_hours: z.number().int().min(1).max(168).nullable().default(null),
    time_of_day: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use a time like 09:00").default("09:00"),
    timezone: z.string().refine(isValidZone, "Unknown time zone. Use a name like Asia/Kolkata or Europe/London").default("Asia/Kolkata"),
    countries: codes,
    integrations: names,
    mode: z.enum(SCHEDULE_MODES).default("scan_prepare"),
    require_approval: z.boolean().default(true),
    max_prepare: z.number().int().min(0).max(200).default(20),
    max_apply: z.number().int().min(0).max(100).default(10),
  })
  .superRefine((s, ctx) => {
    if (s.frequency === "weekly" && s.days.length === 0) ctx.addIssue({ code: "custom", path: ["days"], message: "Choose at least one day of the week" });
    if (s.frequency === "every_n_hours" && s.interval_hours === null) ctx.addIssue({ code: "custom", path: ["interval_hours"], message: "Say how many hours between runs" });
  })
  .transform((s) => ({
    ...s,
    days: s.frequency === "weekly" ? [...new Set(s.days)].sort() : [],
    interval_hours: s.frequency === "every_n_hours" ? s.interval_hours : null,
    countries: [...new Set(s.countries)],
    integrations: [...new Set(s.integrations)],
    // a schedule that never prepares cannot apply
    max_prepare: s.mode === "scan" ? 0 : s.max_prepare,
    max_apply: s.mode === "scan_prepare_apply" ? s.max_apply : 0,
    require_approval: s.mode === "scan_prepare_apply" ? s.require_approval : true,
  }));
export type ScheduleConfig = z.output<typeof ScheduleInput>;

export const BLANK_SCHEDULE: ScheduleConfig = {
  name: "", enabled: true, frequency: "daily", days: [], interval_hours: null, time_of_day: "09:00", timezone: "Asia/Kolkata",
  countries: [], integrations: [], mode: "scan_prepare", require_approval: true, max_prepare: 20, max_apply: 10,
};

export type ScheduleRow = ScheduleConfig & {
  id: string; paused: boolean;
  last_run_at: string | null; last_run_status: string | null; next_run_at: string | null; created_at: string;
};

type Timing = Pick<ScheduleConfig, "frequency" | "days" | "interval_hours" | "time_of_day" | "timezone">;

/**
 * The next time this schedule should fire, strictly after `after`. Wall-clock times are interpreted in the schedule's own
 * time zone, so "09:00 London" stays at 09:00 local when the clocks change. A time that does not exist on a spring-forward
 * day runs just after the gap; a time that happens twice runs once. Only one future run is ever computed: missed runs are
 * not replayed.
 */
export function computeNextRun(s: Timing, after: Date): Date {
  const from = DateTime.fromJSDate(after, { zone: s.timezone });
  if (s.frequency === "every_n_hours") return from.plus({ hours: s.interval_hours ?? 1 }).toJSDate();
  const [hour, minute] = s.time_of_day.split(":").map(Number);
  const allowed = (d: DateTime) => {
    const dow = d.weekday % 7; // luxon: Mon=1..Sun=7 -> 0..6 with Sun=0
    if (s.frequency === "weekdays") return dow >= 1 && dow <= 5;
    if (s.frequency === "weekly") return s.days.includes(dow);
    return true;
  };
  for (let i = 0; i <= 8; i++) {
    const day = from.plus({ days: i });
    const at = day.set({ hour, minute, second: 0, millisecond: 0 });
    if (allowed(day) && at.toMillis() > after.getTime()) return at.toJSDate();
  }
  return from.plus({ days: 1 }).toJSDate(); // unreachable for valid input
}

/** Plain-English summary shown on the Schedules page. */
export function describeSchedule(s: Timing): string {
  const t = s.time_of_day;
  switch (s.frequency) {
    case "daily": return `Every day at ${t} (${s.timezone})`;
    case "weekdays": return `Weekdays at ${t} (${s.timezone})`;
    case "weekly": return `${s.days.map((d) => DAY_NAMES[d]).join(", ")} at ${t} (${s.timezone})`;
    case "every_n_hours": return `Every ${s.interval_hours} hour${s.interval_hours === 1 ? "" : "s"}`;
  }
}

/** Whether a schedule should fire now. A paused or disabled schedule never does; one with no next time is treated as due once. */
export function isDue(s: { enabled: boolean; paused: boolean; next_run_at: string | null }, now: Date): boolean {
  if (!s.enabled || s.paused) return false;
  return !s.next_run_at || new Date(s.next_run_at).getTime() <= now.getTime();
}
