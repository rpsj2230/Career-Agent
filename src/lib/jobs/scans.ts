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

export type RunScansResult = { outcomes: ScanOutcome[]; skipped: number; legacy: boolean; /** searches not even tried because their service had just rejected the login or key */ blocked: { integration: string; reason: string; count: number }[] };

/** Errors that no retry can fix: the service refused the key, token or login. */
export const isAuthFailure = (message: string) => /rejected the token|rejected the key|\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,20}(api.?key|token|credentials)|incorrect (api )?key|authentication failed/i.test(message);

/** A service that did not answer at all (timeout, refused, unreachable), as opposed to answering with an error about one search. */
export const isUnreachable = (message: string) => /could not reach|timed? ?out|aborted|econnreset|econnrefused|enotfound|fetch failed|network/i.test(message);
/** After this many unreachable answers in a row from one service, its remaining searches are left for the next run. */
export const UNREACHABLE_LIMIT = 3;

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
  const blockedBy = new Map<string, { reason: string; count: number }>();

  // Fetching is the slow part (network, and for hosted scrapers minutes), so each integration's requests run in the order given
  // but different integrations run at the same time. Storing stays strictly one scan after another, in the original order, so
  // two sources finding the same job can never both insert it.
  type Fetched = { jobs: NormalizedJob[] } | { error: string } | { skipped: true } | { blocked: string };
  // once a service refuses the key or token, trying its other searches only repeats the same refusal (and used up the whole time budget)
  const broken = new Map<string, string>();
  // a service that does not answer (for example a government site that blocks cloud addresses) would otherwise cost one full timeout per search
  const unreachableInARow = new Map<string, number>();
  const pending = new Map<ScanSpec, Promise<Fetched>>();
  const groups = new Map<string, ScanSpec[]>();
  for (const spec of specs) groups.set(spec.integration, [...(groups.get(spec.integration) ?? []), spec]);
  for (const list of groups.values()) {
    let chain: Promise<unknown> = Promise.resolve();
    for (const spec of list) {
      const p: Promise<Fetched> = chain.then(async () => {
        if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) return { skipped: true } as const;
        const refusal = broken.get(spec.integration);
        if (refusal) return { blocked: refusal } as const;
        try { const jobs = await spec.fetch(); unreachableInARow.set(spec.integration, 0); return { jobs }; } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          if (isAuthFailure(error)) broken.set(spec.integration, error);
          if (isUnreachable(error)) {
            const n = (unreachableInARow.get(spec.integration) ?? 0) + 1;
            unreachableInARow.set(spec.integration, n);
            if (n >= UNREACHABLE_LIMIT && !broken.has(spec.integration)) broken.set(spec.integration, `It did not answer ${n} times in a row (${error.slice(0, 120)}), so its remaining searches were skipped this time and are tried again at the next run.`);
          } else unreachableInARow.set(spec.integration, 0);
          return { error };
        }
      });
      pending.set(spec, p);
      chain = p;
    }
  }

  // The wait for a fetch is capped by what is left of the budget, so a slow source (a hosted scraper can take minutes) can never
  // push a web request past the host's limit. Whatever arrives later is simply not stored this time and is found by the next scan.
  const TIMED_OUT = Symbol("timed out");
  const within = async (p: Promise<Fetched>): Promise<Fetched | typeof TIMED_OUT> => {
    if (opts.budgetMs === undefined) return p;
    const msLeft = Math.max(0, opts.budgetMs - (now() - started));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<typeof TIMED_OUT>((res) => { timer = setTimeout(() => res(TIMED_OUT), msLeft); });
    try { return await Promise.race([p, limit]); } finally { clearTimeout(timer); }
  };

  for (const spec of specs) {
    const waited = await within(pending.get(spec)!);
    if (waited === TIMED_OUT) { skipped++; continue; }
    const got = waited;
    if ("skipped" in got) { skipped++; continue; }
    if ("blocked" in got) { const b = blockedBy.get(spec.integration) ?? { reason: got.blocked, count: 0 }; b.count++; blockedBy.set(spec.integration, b); continue; }
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
  return { outcomes, skipped, legacy, blocked: [...blockedBy].map(([integration, b]) => ({ integration, ...b })) };
}
