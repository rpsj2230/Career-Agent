import { DateTime } from "luxon";

/**
 * Display time zone for the whole app. Servers run in UTC, so formatting without a zone would show times several
 * hours off. Set APP_TIMEZONE (an IANA name such as "Asia/Singapore") to change it.
 */
export const DEFAULT_TZ = "Asia/Kolkata";
export const appTimezone = () => (isValidZone(process.env.APP_TIMEZONE) ? (process.env.APP_TIMEZONE as string) : DEFAULT_TZ);

export function isValidZone(zone: string | undefined | null): boolean {
  return !!zone && DateTime.local().setZone(zone).isValid;
}

const parse = (d: string | Date | null | undefined, tz: string) => {
  if (!d) return null;
  const dt = d instanceof Date ? DateTime.fromJSDate(d, { zone: tz }) : DateTime.fromISO(d, { zone: tz });
  return dt.isValid ? dt : null;
};

export function fmtDateTime(d: string | Date | null | undefined, tz = appTimezone(), empty = "-"): string {
  return parse(d, tz)?.toFormat("d LLL yyyy, h:mm a") ?? empty;
}
export function fmtDate(d: string | Date | null | undefined, tz = appTimezone(), empty = "-"): string {
  return parse(d, tz)?.toFormat("d LLL yyyy") ?? empty;
}
export function fmtTime(d: string | Date | null | undefined, tz = appTimezone(), empty = "-"): string {
  return parse(d, tz)?.toFormat("h:mm:ss a") ?? empty;
}

/** UTC bounds of a calendar day (YYYY-MM-DD) as the user sees it in `tz`. A day can be 23 or 25 hours long around clock changes. */
export function localDayBounds(date: string, tz = appTimezone()): { from: string; to: string } | null {
  const start = DateTime.fromISO(date, { zone: tz });
  if (!start.isValid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { from: start.startOf("day").toUTC().toISO()!, to: start.endOf("day").toUTC().toISO()! };
}

/** Today's date (YYYY-MM-DD) in `tz`, shifted by `daysAgo`. */
export function localDate(daysAgo = 0, tz = appTimezone(), now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: tz }).minus({ days: daysAgo }).toFormat("yyyy-LL-dd");
}

/** "2h 05m" style duration; null when the end is unknown. */
export function fmtDuration(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
