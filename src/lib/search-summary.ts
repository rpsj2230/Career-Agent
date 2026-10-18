import type { ConnectionStatus } from "@/lib/integrations/catalog";

export type SourceRow = {
  id: string; name: string; status: ConnectionStatus; needsConfig: boolean;
  lastScanAt: string | null; scans: number; fetched: number; inserted: number; error: string | null;
};
export type SourceLine = { id: string; name: string; tone: "ok" | "quiet" | "problem" | "off"; headline: string; detail: string };

const BATCH_MS = 90 * 60_000;

/** Fold one source's recent scans (newest first) into the last batch: everything within 90 minutes of its newest scan. */
export function lastBatch(scans: { started_at: string; status: string; fetched: number; inserted: number; error: string | null }[]) {
  if (scans.length === 0) return { at: null as string | null, scans: 0, fetched: 0, inserted: 0, error: null as string | null };
  const newest = new Date(scans[0].started_at).getTime();
  const batch = scans.filter((s) => newest - new Date(s.started_at).getTime() <= BATCH_MS);
  return {
    at: scans[0].started_at, scans: batch.length, fetched: batch.reduce((n, s) => n + s.fetched, 0), inserted: batch.reduce((n, s) => n + s.inserted, 0),
    error: batch.find((s) => s.status === "error")?.error ?? null,
  };
}

/** One plain sentence per source: what it did last time, or exactly why it did nothing. */
export function describeSource(r: SourceRow, now = new Date()): SourceLine {
  const ago = (iso: string) => { const m = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000); return m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const base = { id: r.id, name: r.name };
  if (r.status === "disabled") return { ...base, tone: "off", headline: "Switched off", detail: "Turn it on in Job sources if you want it searched." };
  if (r.status === "needs_setup") return { ...base, tone: "off", headline: "Not connected", detail: r.needsConfig ? "Needs a list of companies to read (Settings, Job discovery)." : "Needs a key or login: open Job sources and follow the setup steps." };
  if (!r.lastScanAt) return { ...base, tone: "quiet", headline: "Not searched yet", detail: "It will be searched on the next search (button above, or the next scheduled run)." };
  if (r.error && r.inserted === 0) return { ...base, tone: "problem", headline: `Failed ${ago(r.lastScanAt)}`, detail: r.error };
  if (r.inserted > 0) return { ...base, tone: "ok", headline: `${r.inserted} new job${r.inserted === 1 ? "" : "s"} ${ago(r.lastScanAt)}`, detail: `${r.fetched} postings read in ${r.scans} search${r.scans === 1 ? "" : "es"}${r.error ? `; one search failed: ${r.error}` : ""}.` };
  return { ...base, tone: "quiet", headline: `Nothing new ${ago(r.lastScanAt)}`, detail: r.fetched > 0 ? `${r.fetched} postings read, all already known or outside your age window.` : "It returned no postings for your roles and countries (some sources only cover certain countries or remote jobs)." };
}
