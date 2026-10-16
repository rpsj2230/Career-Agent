/** When to tell you a source needs attention. Pure, so the rules are easy to test. */

/**
 * Message for a change of state after a scan: alert once when a working source starts failing, and once when it
 * recovers. Repeated failures stay quiet (they are in the logs and on the dashboard), so you are not spammed hourly.
 */
export function transitionAlert(prev: string | null | undefined, ok: boolean, name: string, error?: string): string | null {
  if (!ok && prev !== "error") return `${name} stopped working: ${(error ?? "scan failed").slice(0, 300)}\nOpen Portals to test it.`;
  if (ok && prev === "error") return `${name} is working again.`;
  return null;
}

export type HealthRow = {
  id: string; name: string; enabled: boolean;
  /** has credentials/config, i.e. it is expected to be scanning */
  ready: boolean;
  last_scan_at: string | null; last_ok_at: string | null; stale_alerted_at: string | null;
};

const DAY = 86_400_000;

/**
 * Sources that are switched on and set up but have not had a successful scan for `staleDays`, at most one reminder
 * per source per day. A source that was never scanned is only reported after it has existed that long (`since`).
 */
export function staleAlerts(rows: HealthRow[], now: Date, staleDays = 3): { id: string; message: string }[] {
  const out: { id: string; message: string }[] = [];
  for (const r of rows) {
    if (!r.enabled || !r.ready) continue;
    if (r.stale_alerted_at && now.getTime() - new Date(r.stale_alerted_at).getTime() < DAY) continue;
    const last = r.last_ok_at ? new Date(r.last_ok_at).getTime() : null;
    if (last === null) {
      if (r.last_scan_at && now.getTime() - new Date(r.last_scan_at).getTime() > staleDays * DAY) out.push({ id: r.id, message: `${r.name} has never completed a scan successfully. Open Portals to test it.` });
      continue;
    }
    const days = Math.floor((now.getTime() - last) / DAY);
    if (days >= staleDays) out.push({ id: r.id, message: `${r.name} has not completed a successful scan for ${days} days. It may need new credentials or have changed. Open Portals to test it.` });
  }
  return out;
}
