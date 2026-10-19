import { LOG_CATEGORIES, LOG_KINDS } from "./activity-types";
import { safeSearch } from "./filters";
import { PAGE_SIZES } from "./pagination";
import { localDate } from "./time";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PAGE_SIZE = 25; // the default; 10, 25, 50 or 100 can be chosen with ?size=
export const LOG_LEVELS = ["info", "warn", "error"] as const;
export const LOG_STATUSES = ["matched", "rejected", "verified", "unverified", "prepared", "approved", "assisted_pending", "submitted", "skipped", "blocked", "failed", "needs_input", "ok", "error", "succeeded", "partial"] as const;

export type LogFilters = {
  from?: string; to?: string;
  level?: (typeof LOG_LEVELS)[number];
  category?: string; kind?: string;
  portal?: string; country?: string; company?: string; status?: string;
  run?: string; app?: string; job?: string; q?: string;
  /** which end of the history to start from (default: newest first) */
  order?: "oldest";
  page: number;
  size: number;
};

const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** Validates every filter; anything malformed is dropped rather than passed to the database. */
export function parseLogFilters(sp: SP): LogFilters {
  const level = one(sp.level) as LogFilters["level"];
  const category = one(sp.category);
  const kind = one(sp.kind);
  const portal = one(sp.portal)?.toLowerCase();
  const country = one(sp.country)?.toLowerCase();
  const status = one(sp.status)?.toLowerCase();
  const id = (v: string | string[] | undefined) => { const x = one(v); return x && UUID.test(x) ? x.toLowerCase() : undefined; };
  const page = Math.floor(Number(one(sp.page)));
  return {
    from: date(one(sp.from)), to: date(one(sp.to)),
    level: level && (LOG_LEVELS as readonly string[]).includes(level) ? level : undefined,
    category: category && (LOG_CATEGORIES as readonly string[]).includes(category) ? category : undefined,
    kind: kind && (LOG_KINDS as readonly string[]).includes(kind) ? kind : undefined,
    portal: portal && /^[a-z0-9]{1,40}$/.test(portal) ? portal : undefined,
    country: country && /^[a-z]{2}$/.test(country) ? country : undefined,
    company: safeSearch(one(sp.company)) || undefined,
    status: status && /^[a-z_]{1,30}$/.test(status) ? status : undefined,
    run: id(sp.run), app: id(sp.app), job: id(sp.job),
    q: safeSearch(one(sp.q)) || undefined,
    order: one(sp.order) === "oldest" ? "oldest" : undefined,
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(Number(one(sp.size))) ? Number(one(sp.size)) : PAGE_SIZE,
  };
}

/** Query string for a filter set (used for pagination, presets and deep links). Defaults are omitted. */
export function logHref(f: Partial<LogFilters>, base = "/logs"): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "" && !(k === "page" && v === 1) && !(k === "size" && v === PAGE_SIZE)) p.set(k, String(v));
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** Date presets resolved in the display time zone. */
export function presetRange(preset: "today" | "7d" | "30d", tz?: string, now?: Date): { from: string; to: string } {
  const to = localDate(0, tz, now);
  return { from: preset === "today" ? to : localDate(preset === "7d" ? 6 : 29, tz, now), to };
}

/** The filters currently in force, as human-readable labels (shown as removable chips). */
export function activeFilterLabels(f: LogFilters): { key: keyof LogFilters; label: string }[] {
  const out: { key: keyof LogFilters; label: string }[] = [];
  if (f.from) out.push({ key: "from", label: `from ${f.from}` });
  if (f.to) out.push({ key: "to", label: `to ${f.to}` });
  if (f.level) out.push({ key: "level", label: `level: ${f.level}` });
  if (f.category) out.push({ key: "category", label: `type: ${f.category}` });
  if (f.kind) out.push({ key: "kind", label: `event: ${f.kind}` });
  if (f.portal) out.push({ key: "portal", label: `portal: ${f.portal}` });
  if (f.country) out.push({ key: "country", label: `country: ${f.country.toUpperCase()}` });
  if (f.company) out.push({ key: "company", label: `company: ${f.company}` });
  if (f.status) out.push({ key: "status", label: `status: ${f.status}` });
  if (f.run) out.push({ key: "run", label: `run ${f.run.slice(0, 8)}` });
  if (f.app) out.push({ key: "app", label: `application ${f.app.slice(0, 8)}` });
  if (f.job) out.push({ key: "job", label: `job ${f.job.slice(0, 8)}` });
  if (f.order) out.push({ key: "order", label: "oldest first" });
  if (f.q) out.push({ key: "q", label: `text: ${f.q}` });
  return out;
}
