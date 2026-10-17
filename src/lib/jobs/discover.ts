import "server-only";
import { finishScan, startScan, withRun, type RunCtx } from "@/lib/activity";
import { type IntegrationId } from "@/lib/integrations/catalog";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { loadIntegrationStates, recordIntegrationScan } from "@/lib/integrations/state";
import { getSetting } from "@/lib/settings";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import type { RunTrigger } from "@/lib/activity-types";
import { ingestScan, loadKnownJobs } from "./ingest";
import { runScans, type ScanDeps } from "./scans";
import { buildScanSpecs, searchQueries, type DiscoverySettings } from "./sources";

/**
 * What to search: the Countries page when configured (each country with its own titles, locations and remote
 * preference), otherwise Settings > Job discovery / profile preferences as before.
 */
export async function effectiveDiscovery(): Promise<DiscoverySettings> {
  const [settings, { countries }, apify] = await Promise.all([getSetting("discovery"), loadEffectiveCountries(), getSetting("apify")]);
  return {
    ...settings,
    countries: countries.map((c) => c.country),
    roles: [...new Set(countries.flatMap((c) => c.titles))],
    perCountry: countries,
    apify_actors: apify.actors,
  };
}

export type ScanScope = { only?: IntegrationId; integrations?: string[]; countries?: string[]; budgetMs?: number };

/** One scan step inside an existing run (a schedule's pipeline, or the standalone "Find jobs" run). */
export async function scanStep(ctx: RunCtx, o: ScanScope) {
  const all = await effectiveDiscovery();
  const wantCountry = o.countries?.length ? new Set(o.countries) : null;
  const perCountry = wantCountry ? all.perCountry?.filter((c) => wantCountry.has(c.country)) : all.perCountry;
  const settings: DiscoverySettings = { ...all, perCountry, countries: perCountry?.map((c) => c.country) ?? all.countries };
  if (!settings.perCountry?.length) throw new Error(wantCountry ? "None of this schedule's countries is enabled on the Countries page." : "No countries to search. Enable a country on the Countries page, or set countries in Settings.");
  if (searchQueries(settings).length === 0) throw new Error("No job titles to search. Add titles for a country, or roles in Settings or your profile preferences.");
  const { creds } = await resolveCredentials();
  const { states } = await loadIntegrationStates();
  const allowed = o.integrations?.length ? new Set(o.integrations) : null;
  const specs = buildScanSpecs(settings, creds, (id) => (states.get(id)?.enabled ?? true) && (!allowed || allowed.has(id)), { only: o.only });
  if (specs.length === 0) {
    ctx.markPartial("Nothing to scan: no connected integration is ready. Connect one on the Portals page.");
    return { outcomes: [], skipped: 0, legacy: false, settings };
  }
  const known = await loadKnownJobs();
  const existing = new Set(known.keys());
  const deps: ScanDeps = {
    startScan: (m) => startScan({ ...m, run_id: ctx.id }),
    finishScan: (id, m, r) => finishScan(id, { ...m, run_id: ctx.id }, r),
    ingest: (jobs, scanId) => ingestScan(jobs, { maxAgeDays: settings.max_age_days, existing, known, scanId, runId: ctx.id }),
    recordIntegration: (id, r) => recordIntegrationScan(id, r),
  };
  const res = await runScans(specs, deps, { budgetMs: o.budgetMs });
  for (const s of res.outcomes) {
    ctx.stat("scans");
    ctx.stat("fetched", s.counts.fetched); ctx.stat("inserted", s.counts.inserted); ctx.stat("duplicates", s.counts.duplicates);
    ctx.stat("stale", s.counts.stale); ctx.stat("invalid", s.counts.invalid);
    if (!s.ok) ctx.stat("scan_errors");
  }
  const failed = res.outcomes.filter((s) => !s.ok);
  if (failed.length) ctx.markPartial(`${failed.length} of ${res.outcomes.length} scans failed. First: ${failed[0].integration}${failed[0].query ? ` "${failed[0].query}"` : ""}: ${failed[0].error}`);
  if (res.skipped) ctx.markPartial(`${res.skipped} scan(s) not started because the time limit was reached; run again to continue`);
  if (res.legacy) ctx.markPartial("Database update pending: portal and scan details were not saved. Open System to apply it.");
  return { ...res, settings };
}

/**
 * Scan the connected integrations inside a recorded run. Every scan, its counts and its errors are stored;
 * a failing source marks the run partial rather than losing the others; the run is always finalised.
 */
export async function discoverNow(o: { trigger: RunTrigger; only?: IntegrationId; budgetMs?: number; scheduleId?: string | null }) {
  return withRun({ trigger: o.trigger, kind: "scan", schedule_id: o.scheduleId ?? null, scope: { only: o.only ?? "all" } }, (ctx) => scanStep(ctx, { only: o.only, budgetMs: o.budgetMs }));
}
