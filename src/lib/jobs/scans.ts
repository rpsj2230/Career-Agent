import type { IntegrationId } from "@/lib/integrations/catalog";
import type { NormalizedJob } from "./normalize";
import type { ScanSpec } from "./sources";

export type ScanCounts = { fetched: number; inserted: number; duplicates: number; stale: number; invalid: number };
export type ScanOutcome = { integration: IntegrationId; country?: string; query?: string; ok: boolean; error?: string; counts: ScanCounts };

export type ScanDeps = {
  startScan(o: { integration: string; country?: string; query?: string }): Promise<string | null>;
  finishScan(id: string | null, o: { integration: string; country?: string; query?: string }, r: { status: "ok" | "error"; error?: string } & Partial<ScanCounts>): Promise<void>;
  ingest(jobs: NormalizedJob[], scanId: string | null): Promise<{ inserted: number; duplicates: number; stale: number; invalid: number; legacy?: boolean }>;
  recordIntegration(id: IntegrationId, r: { ok: boolean; error?: string; inserted: number }): Promise<void>;
  now?: () => number;
};

export type RunScansResult = { outcomes: ScanOutcome[]; skipped: number; legacy: boolean };

/**
 * Run every scan, one at a time. Each scan is recorded before it starts and finalised whether it succeeds or
 * fails, a failure in one never stops the others, and integration status is updated from the results.
 * `budgetMs` stops starting new scans once the time is used up and reports how many were left (`skipped`),
 * so a time-limited caller can tell the user to continue instead of silently dropping work.
 */
export async function runScans(specs: ScanSpec[], deps: ScanDeps, opts: { budgetMs?: number } = {}): Promise<RunScansResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const outcomes: ScanOutcome[] = [];
  let skipped = 0;
  let legacy = false;

  for (const spec of specs) {
    if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) { skipped++; continue; }
    const meta = { integration: spec.integration, country: spec.country, query: spec.query };
    const scanId = await deps.startScan(meta);
    try {
      const jobs = await spec.fetch();
      const r = await deps.ingest(jobs, scanId);
      legacy ||= !!r.legacy;
      const counts: ScanCounts = { fetched: jobs.length, inserted: r.inserted, duplicates: r.duplicates, stale: r.stale, invalid: r.invalid };
      await deps.finishScan(scanId, meta, { status: "ok", ...counts });
      outcomes.push({ ...meta, ok: true, counts });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await deps.finishScan(scanId, meta, { status: "error", error });
      outcomes.push({ ...meta, ok: false, error, counts: { fetched: 0, inserted: 0, duplicates: 0, stale: 0, invalid: 0 } });
    }
  }

  // integration-level status from this run's scans
  const byIntegration = new Map<IntegrationId, ScanOutcome[]>();
  for (const o of outcomes) byIntegration.set(o.integration, [...(byIntegration.get(o.integration) ?? []), o]);
  for (const [id, list] of byIntegration) {
    const failed = list.filter((o) => !o.ok);
    const inserted = list.reduce((n, o) => n + o.counts.inserted, 0);
    await deps.recordIntegration(id, { ok: failed.length === 0, error: failed[0]?.error, inserted });
  }
  return { outcomes, skipped, legacy };
}
