export type ScanLike = { integration: string; portal?: string | null; country?: string | null; status: string; fetched: number; inserted: number; duplicates: number; stale: number; invalid: number; started_at: string; error?: string | null };

export type SourceTotals = { integration: string; scans: number; failed: number; fetched: number; inserted: number; duplicates: number; lastScanAt: string; lastError: string | null };

/** Per integration: how many scans ran, how many failed, and how many jobs they found and added. */
export function summarizeScans(scans: ScanLike[]): SourceTotals[] {
  const m = new Map<string, SourceTotals>();
  for (const s of scans) {
    const t = m.get(s.integration) ?? { integration: s.integration, scans: 0, failed: 0, fetched: 0, inserted: 0, duplicates: 0, lastScanAt: s.started_at, lastError: null };
    t.scans++;
    if (s.status === "error") t.failed++;
    t.fetched += s.fetched; t.inserted += s.inserted; t.duplicates += s.duplicates;
    if (s.started_at >= t.lastScanAt) { t.lastScanAt = s.started_at; }
    if (s.status === "error" && s.error && !t.lastError) t.lastError = s.error;
    m.set(s.integration, t);
  }
  return [...m.values()].sort((a, b) => b.inserted - a.inserted || a.integration.localeCompare(b.integration));
}
