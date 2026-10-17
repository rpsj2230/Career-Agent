import { fmtDate } from "@/lib/time";

export type ReportScan = { integration: string; country: string | null; query: string | null; status: string; fetched: number; inserted: number; duplicates: number; stale: number; invalid: number; error: string | null; detail?: Record<string, unknown> | null };

/** "Posted 1 Jan - 3 Jan" for a scan that asked for the last N days. Null when the scan did not record its window. */
export function windowLabel(detail: Record<string, unknown> | null | undefined, tz?: string): string | null {
  const from = detail?.window_from, to = detail?.window_to;
  if (typeof from !== "string" || typeof to !== "string") return null;
  const f = fmtDate(from, tz), t = fmtDate(to, tz);
  return f === t ? f : `${f} to ${t}`;
}

export type SourceLine = { source: string; scans: number; failed: number; fetched: number; inserted: number; duplicates: number; stale: number; invalid: number; window: string | null };

/** One line per source for a run, with the posting-date window it asked for. */
export function bySource(scans: ReportScan[], label: (id: string) => string, tz?: string): SourceLine[] {
  const m = new Map<string, SourceLine>();
  for (const s of scans) {
    const l = m.get(s.integration) ?? { source: label(s.integration), scans: 0, failed: 0, fetched: 0, inserted: 0, duplicates: 0, stale: 0, invalid: 0, window: null };
    l.scans++; if (s.status === "error") l.failed++;
    l.fetched += s.fetched; l.inserted += s.inserted; l.duplicates += s.duplicates; l.stale += s.stale; l.invalid += s.invalid;
    l.window ??= windowLabel(s.detail, tz);
    m.set(s.integration, l);
  }
  return [...m.values()].sort((a, b) => b.fetched - a.fetched || a.source.localeCompare(b.source));
}

/** One plain sentence about what a run did, built from its counters. */
export function runSentence(stats: Record<string, number>, sources: SourceLine[]): string {
  const n = (k: string) => stats[k] ?? 0;
  const fetched = sources.reduce((a, s) => a + s.fetched, 0) || n("fetched");
  const parts: string[] = [];
  if (sources.length || fetched) parts.push(`Fetched ${fetched} job${fetched === 1 ? "" : "s"} from ${sources.length} source${sources.length === 1 ? "" : "s"} (${n("inserted")} new, ${n("duplicates")} already known${n("stale") ? `, ${n("stale")} too old` : ""})`);
  if (n("rejected_by_rules")) parts.push(`${n("rejected_by_rules")} skipped by your rules`);
  if (n("scored")) parts.push(`${n("scored")} scored (${n("rejected")} below your threshold)`);
  if (n("prepared")) parts.push(`${n("prepared")} prepared`);
  if (n("auto_approved")) parts.push(`${n("auto_approved")} approved automatically`);
  if (n("manual_required")) parts.push(`${n("manual_required")} need you to apply`);
  if (n("failed") || n("prepare_failed")) parts.push(`${n("failed") + n("prepare_failed")} failed`);
  return parts.length ? `${parts.join("; ")}.` : "Nothing was recorded for this run.";
}

export type ApplyLog = { kind: string; portal: string | null; country: string | null; status: string | null; detail: Record<string, unknown> | null };
export type ApplyRow = { key: string; submitted: number; needsYou: number; failed: number };
export type ApplyReport = {
  submitted: number; byScheduleApproved: number; byYouApproved: number; needsYou: number; failed: number;
  byMethod: { automated: number; assisted: number }; byPortal: ApplyRow[]; byCountry: ApplyRow[];
};

/** Roll the application log lines of a period into "how many applied, by whom, through what, where". */
export function applyReport(rows: ApplyLog[], portalLabel: (id: string) => string = (x) => x, countryLabel: (id: string) => string = (x) => x): ApplyReport {
  const r: ApplyReport = { submitted: 0, byScheduleApproved: 0, byYouApproved: 0, needsYou: 0, failed: 0, byMethod: { automated: 0, assisted: 0 }, byPortal: [], byCountry: [] };
  const portals = new Map<string, ApplyRow>(), countries = new Map<string, ApplyRow>();
  const row = (m: Map<string, ApplyRow>, key: string) => m.get(key) ?? (m.set(key, { key, submitted: 0, needsYou: 0, failed: 0 }), m.get(key)!);
  for (const x of rows) {
    const p = row(portals, x.portal ? portalLabel(x.portal) : "Unknown"), c = row(countries, x.country ? countryLabel(x.country) : "Unknown");
    if (x.kind === "application.submitted") {
      r.submitted++; p.submitted++; c.submitted++;
      if (x.detail?.method === "assisted") r.byMethod.assisted++; else r.byMethod.automated++;
    } else if (x.kind === "application.approved") {
      if (x.detail?.actor === "schedule") r.byScheduleApproved++; else r.byYouApproved++;
    } else if (x.kind === "application.needs_input" || x.kind === "application.manual") { r.needsYou++; p.needsYou++; c.needsYou++; }
    else if (x.kind === "application.failed") { r.failed++; p.failed++; c.failed++; }
  }
  const sort = (m: Map<string, ApplyRow>) => [...m.values()].sort((a, b) => b.submitted - a.submitted || b.needsYou + b.failed - (a.needsYou + a.failed));
  r.byPortal = sort(portals); r.byCountry = sort(countries);
  return r;
}
