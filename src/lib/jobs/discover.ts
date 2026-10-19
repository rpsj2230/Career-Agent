import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import { db } from "@/lib/db";
import { finishScan, startScan, withRun, type RunCtx } from "@/lib/activity";
import { integrationById, type IntegrationId } from "@/lib/integrations/catalog";
import { alertOnce } from "@/lib/alerts";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { loadIntegrationStates, recordIntegrationScan } from "@/lib/integrations/state";
import { getSetting, putSetting } from "@/lib/settings";
import { ATS_LABEL, EMPTY_WATCHLIST, mergeWatchlist, type Watchlist } from "./ats";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import type { RunTrigger } from "@/lib/activity-types";
import { effectiveIntervalHours, idleStreak, silentDrop } from "./adaptive";
import { apifyBudget } from "./apify-usage";
import { ingestScan, loadKnownJobs } from "./ingest";
import { runScans, type ScanDeps } from "./scans";
import { buildScanSpecs, searchQueries, windowDays, type DiscoverySettings } from "./sources";

/**
 * What to search: the Countries page when configured (each country with its own titles, locations and remote
 * preference), otherwise Settings > Job discovery / profile preferences as before.
 */
export async function effectiveDiscovery(): Promise<DiscoverySettings> {
  const [settings, { countries }, apify, watchlist] = await Promise.all([getSetting("discovery"), loadEffectiveCountries(), getSetting("apify"), getSetting("watchlist")]);
  return {
    ...settings,
    countries: countries.map((c) => c.country),
    roles: [...new Set(countries.flatMap((c) => c.titles))],
    perCountry: countries,
    apify_actors: apify.actors,
    apify_budget: await apifyBudget(),
    watch: watchlist.enabled ? (watchlist.boards as DiscoverySettings["watch"]) : undefined,
  };
}

export type ScanScope = { only?: IntegrationId; integrations?: string[]; countries?: string[]; budgetMs?: number; /** search even if it ran a moment ago (the Scan now button) */ force?: boolean; /** a web request with a hard time limit: hosted scrapers (minutes per run) are left to the scheduled GitHub run */ interactive?: boolean };

const scanKey = (integration: string, country?: string | null, query?: string | null) => `${integration}|${country ?? ""}|${query ?? ""}`;

/** For each search (integration + country + query): its recent successful runs, newest first. Tolerates a missing table. */
async function recentScans(): Promise<Map<string, { at: Date; inserted: number; fetched: number }[]>> {
  const res = await fetchAll((a, b) => db().from("portal_scans").select("integration,country,query,started_at,inserted,fetched").eq("status", "ok").order("started_at", { ascending: false }).order("id").range(a, b), 4000);
  const out = new Map<string, { at: Date; inserted: number; fetched: number }[]>();
  if (res.error) return out;
  for (const r of res.data as { integration: string; country: string | null; query: string | null; started_at: string; inserted: number | null; fetched: number | null }[]) {
    const k = scanKey(r.integration, r.country, r.query);
    const list = out.get(k) ?? [];
    if (list.length < 6) list.push({ at: new Date(r.started_at), inserted: r.inserted ?? 0, fetched: r.fetched ?? 0 });
    out.set(k, list);
  }
  return out;
}

/** A source that answers without errors but suddenly returns nothing for searches that always found something has probably changed. */
async function flagSilentSources(ctx: RunCtx, outcomes: { integration: string; country?: string; query?: string; ok: boolean; counts: { fetched: number } }[], history: Map<string, { fetched: number }[]>) {
  const byIntegration = new Map<string, { key: string; fetched: number }[]>();
  for (const o of outcomes.filter((x) => x.ok)) byIntegration.set(o.integration, [...(byIntegration.get(o.integration) ?? []), { key: scanKey(o.integration, o.country, o.query), fetched: o.counts.fetched }]);
  for (const [id, current] of byIntegration) {
    if (!silentDrop(current, history)) continue;
    const name = integrationById(id)?.name ?? id;
    const message = `${name} returned no jobs for searches that normally return some, without reporting an error. Its source may have changed. Open Portals and press Test.`;
    ctx.markPartial(message);
    if (await alertOnce(`silent:${id}`, 24, `Career Agent: ${message}`)) await ctx.log({ kind: "integration.error", level: "warn", message, integration: id, status: "silent", detail: { searches: current.length } });
  }
}

/** Companies seen posting matching jobs join the watchlist, so their other openings are read directly next time. */
async function rememberBoards(ctx: RunCtx, urls: string[], settings: DiscoverySettings) {
  const wl = await getSetting("watchlist");
  if (!wl.enabled) return;
  const { watchlist, added } = mergeWatchlist({ boards: { ...EMPTY_WATCHLIST.boards, ...(wl.boards as Watchlist["boards"]) }, added: wl.added }, urls, { greenhouse: settings.greenhouse_boards, lever: settings.lever_companies, ashby: settings.ashby_orgs, workable: settings.workable_accounts, recruitee: settings.recruitee_companies });
  if (!added.length) return;
  await putSetting("watchlist", { enabled: true, boards: watchlist.boards, added: watchlist.added });
  ctx.stat("boards_found", added.length);
  await ctx.log({ kind: "integration.changed", message: `Found ${added.length} new company board(s) to read directly: ${added.slice(0, 8).map((a) => `${ATS_LABEL[a.ats]} ${a.board}`).join(", ")}${added.length > 8 ? " ..." : ""}`, status: "discovered", detail: { added } });
}

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
  const history = await recentScans();
  const last = new Map([...history].map(([k, v]) => [k, v[0].at]));
  settings.since = (i, c, q) => last.get(scanKey(i, c, q)) ?? null;
  let specs = buildScanSpecs(settings, creds, (id) => (states.get(id)?.enabled ?? true) && (!allowed || allowed.has(id)), { only: o.only });
  if (o.interactive) {
    const slow = specs.filter((sp) => sp.integration === "apify").length;
    if (slow) { specs = specs.filter((sp) => sp.integration !== "apify"); ctx.stat("hosted_scrapers_deferred", slow); }
  }
  // a search that ran moments ago would only find the same jobs: skip it (saves time and free-plan quota)
  const minHours = settings.min_rescan_hours ?? 6;
  let recentlySearched = 0;
  if (!o.force && minHours > 0) {
    const fresh = specs.filter((sp) => {
      const k = scanKey(sp.integration, sp.country, sp.query);
      const at = last.get(k);
      // a search that keeps finding nothing new is asked less often (never less often than daily)
      return at && Date.now() - at.getTime() < effectiveIntervalHours(minHours, idleStreak(history.get(k) ?? [])) * 3_600_000;
    });
    if (fresh.length) {
      specs = specs.filter((sp) => !fresh.includes(sp));
      recentlySearched = fresh.length;
      ctx.stat("recently_searched", fresh.length);
    }
  }
  if (specs.length === 0) {
    // everything was searched within the last few hours: that is a success, not a problem
    if (recentlySearched === 0) ctx.markPartial("Nothing to scan: no connected integration is ready. Connect one on the Portals page.");
    return { outcomes: [], skipped: 0, legacy: false, settings };
  }
  for (const sp of specs) sp.windowDays = windowDays(settings, sp); // recorded on each scan: which posting dates it asked for
  const known = await loadKnownJobs();
  const existing = new Set(known.keys());
  const seenUrls = new Set<string>();
  const deps: ScanDeps = {
    startScan: (m) => startScan({ ...m, run_id: ctx.id }),
    finishScan: (id, m, r) => finishScan(id, { ...m, run_id: ctx.id }, r),
    ingest: (jobs, scanId) => { for (const j of jobs) seenUrls.add(j.url); return ingestScan(jobs, { maxAgeDays: settings.max_age_days, existing, known, scanId, runId: ctx.id }); },
    recordIntegration: (id, r) => recordIntegrationScan(id, r),
  };
  const res = await runScans(specs, deps, { budgetMs: o.budgetMs });
  await flagSilentSources(ctx, res.outcomes, history).catch((e) => console.error("silent-failure check failed:", e instanceof Error ? e.message : e));
  await rememberBoards(ctx, [...seenUrls], settings).catch((e) => console.error("could not update the company watchlist:", e instanceof Error ? e.message : e));
  for (const s of res.outcomes) {
    ctx.stat("scans");
    ctx.stat("fetched", s.counts.fetched); ctx.stat("inserted", s.counts.inserted); ctx.stat("duplicates", s.counts.duplicates);
    ctx.stat("stale", s.counts.stale); ctx.stat("invalid", s.counts.invalid);
    if (!s.ok) ctx.stat("scan_errors");
  }
  const failed = res.outcomes.filter((s) => !s.ok);
  if (failed.length) ctx.markPartial(`${failed.length} of ${res.outcomes.length} scans failed. First: ${failed[0].integration}${failed[0].query ? ` "${failed[0].query}"` : ""}: ${failed[0].error}`);
  for (const b of res.blocked) { ctx.stat("scans_blocked", b.count); ctx.markPartial(`${b.integration}: ${b.reason} The other ${b.count} ${b.integration} search(es) were not tried until this is fixed (Job sources page).`); }
  if (res.skipped) ctx.markPartial(`${res.skipped} scan(s) not started because the time limit was reached; run again to continue`);
  if (res.legacy) ctx.markPartial("Database update pending: portal and scan details were not saved. Open System to apply it.");
  return { ...res, settings };
}

/**
 * Scan the connected integrations inside a recorded run. Every scan, its counts and its errors are stored;
 * a failing source marks the run partial rather than losing the others; the run is always finalised.
 */
export async function discoverNow(o: { trigger: RunTrigger; only?: IntegrationId; budgetMs?: number; scheduleId?: string | null; force?: boolean; interactive?: boolean }) {
  return withRun({ trigger: o.trigger, kind: "scan", schedule_id: o.scheduleId ?? null, scope: { only: o.only ?? "all" } }, (ctx) => scanStep(ctx, { only: o.only, budgetMs: o.budgetMs, force: o.force, interactive: o.interactive }));
}
