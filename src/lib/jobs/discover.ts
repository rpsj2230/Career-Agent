import "server-only";
import { finishScan, startScan, withRun } from "@/lib/activity";
import { type IntegrationId } from "@/lib/integrations/catalog";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { loadIntegrationStates, recordIntegrationScan } from "@/lib/integrations/state";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import type { RunTrigger } from "@/lib/activity-types";
import { ingestScan, loadExistingKeys } from "./ingest";
import { runScans, type ScanDeps } from "./scans";
import { buildScanSpecs, type DiscoverySettings } from "./sources";

/** Settings > Job discovery, falling back to profile preferences when countries or roles are blank. */
export async function effectiveDiscovery(): Promise<DiscoverySettings> {
  const [settings, profile] = await Promise.all([getSetting("discovery"), getProfile()]);
  return {
    ...settings,
    countries: settings.countries.length ? settings.countries : profile.preferences.countries,
    roles: settings.roles.length ? settings.roles : profile.preferences.roles,
  };
}

/**
 * Scan the connected integrations inside a recorded run. Every scan, its counts and its errors are stored;
 * a failing source marks the run partial rather than losing the others; the run is always finalised.
 */
export async function discoverNow(o: { trigger: RunTrigger; only?: IntegrationId; budgetMs?: number; scheduleId?: string | null }) {
  return withRun({ trigger: o.trigger, kind: "scan", schedule_id: o.scheduleId ?? null, scope: { only: o.only ?? "all" } }, async (ctx) => {
    const settings = await effectiveDiscovery();
    if (settings.roles.length === 0) throw new Error("No target roles set. Add roles in Settings or in your profile preferences.");
    const { creds } = await resolveCredentials();
    const { states } = await loadIntegrationStates();
    const specs = buildScanSpecs(settings, creds, (id) => states.get(id)?.enabled ?? true, { only: o.only });
    if (specs.length === 0) {
      ctx.markPartial("Nothing to scan: no connected integration is ready. Connect one on the Portals page.");
      return { outcomes: [], skipped: 0, legacy: false, settings };
    }
    const existing = await loadExistingKeys();
    const deps: ScanDeps = {
      startScan: (m) => startScan({ ...m, run_id: ctx.id }),
      finishScan: (id, m, r) => finishScan(id, { ...m, run_id: ctx.id }, r),
      ingest: (jobs, scanId) => ingestScan(jobs, { maxAgeDays: settings.max_age_days, existing, scanId, runId: ctx.id }),
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
  });
}
