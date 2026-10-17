import type { IntegrationId } from "@/lib/integrations/catalog";
import type { NormalizedJob } from "./normalize";
import type { ScanSpec } from "./sources";

export type ScanCounts = { fetched: number; inserted: number; duplicates: number; stale: number; invalid: number };
export type ScanOutcome = { integration: IntegrationId; country?: string; query?: string; ok: boolean; error?: string; counts: ScanCounts };

export type ScanDeps = {
  startScan(o: { integration: string; country?: string; query?: string }): Promise<string | null>;
  finishScan(id: string | null, o: { integration: string; country?: string; query?: string }, r: { status: "ok" | "error"; error?: string; detail?: Record<string, unknown> } & Partial<ScanCounts>): Promise<void>;
  ingest(jobs: NormalizedJob[], scanId: string | null): Promise<{ inserted: number; duplicates: number; stale: number; invalid: number; legacy?: boolean }>;
  recordIntegration(id: IntegrationId, r: { ok: boolean; error?: string; inserted: number }): Promise<void>;
  now?: () => number;
};

export type RunScansResult = { outcomes: ScanOutcome[]; skipped: number; legacy: boolean };

/**
 * Run every scan (fetching in parallel across integrations, storing one at a time). Each scan is recorded before it starts and finalised whether it succeeds or
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

  // Fetching is the slow part (network, and for hosted scrapers minutes), so each integration's requests run in the order given
  // but different integrations run at the same time. Storing stays strictly one scan after another, in the original order, so
  // two sources finding the same job can never both insert it.
  type Fetched = { jobs: NormalizedJob[] } | { error: string } | { skipped: true };
  const pending = new Map<ScanSpec, Promise<Fetched>>();
  const groups = new Map<string, ScanSpec[]>();
  for (const spec of specs) groups.set(spec.integration, [...(groups.get(spec.integration) ?? []), spec]);
  for (const list of groups.values()) {
    let chain: Promise<unknown> = Promise.resolve();
    for (const spec of list) {
      const p: Promise<Fetched> = chain.then(async () => {
        if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) return { skipped: true } as const;
        try { return { jobs: await spec.fetch() }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      });
      pending.set(spec, p);
      chain = p;
    }
  }

  for (const spec of specs) {
    const got = await pending.get(spec)!;
    if ("skipped" in got) { skipped++; continue; }
    const meta = { integration: spec.integration, country: spec.country, query: spec.query };
    const scanId = await deps.startScan(meta);
    const detail = spec.windowDays ? { window_days: spec.windowDays, window_from: new Date(now() - spec.windowDays * 86_400_000).toISOString(), window_to: new Date(now()).toISOString() } : undefined;
    try {
      if ("error" in got) throw new Error(got.error);
      const jobs = got.jobs;
      const r = await deps.ingest(jobs, scanId);
      legacy ||= !!r.legacy;
      const counts: ScanCounts = { fetched: jobs.length, inserted: r.inserted, duplicates: r.duplicates, stale: r.stale, invalid: r.invalid };
      await deps.finishScan(scanId, meta, { status: "ok", ...counts, detail });
      outcomes.push({ ...meta, ok: true, counts });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await deps.finishScan(scanId, meta, { status: "error", error, detail });
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
