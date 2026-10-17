import "server-only";
import { db } from "@/lib/db";
import { isMissingSchemaError } from "@/lib/schema";
import { effectiveDiscovery } from "@/lib/jobs/discover";
import { derivePortalStatus, deriveStatus, INTEGRATIONS, PORTALS, type ConnectionStatus, type IntegrationDef, type IntegrationId, type PortalDef } from "./catalog";
import { resolveCredentials, isComplete, type CredentialSource } from "./credentials";
import { loadIntegrationStates, type IntegrationRow } from "./state";

export type ScanRow = { id: string; integration: string; country: string | null; query: string | null; status: string; started_at: string; fetched: number; inserted: number; duplicates: number; error: string | null };

export type IntegrationView = {
  def: IntegrationDef;
  status: ConnectionStatus;
  state?: IntegrationRow;
  sources: Record<string, CredentialSource>;
  recentScans: ScanRow[];
};
export type PortalView = { def: PortalDef; status: ConnectionStatus; note: string; jobs: number; lastSeen: string | null };

export async function loadPortalsView() {
  const [{ states, schemaMissing }, { sources }, discovery] = await Promise.all([loadIntegrationStates(), resolveCredentials(), effectiveDiscovery()]);

  // recent scans per integration (tolerant of a missing table)
  let scans: ScanRow[] = [];
  const sr = await db().from("portal_scans").select("id,integration,country,query,status,started_at,fetched,inserted,duplicates,error").order("started_at", { ascending: false }).limit(120);
  if (!sr.error) scans = sr.data as ScanRow[];
  else if (!isMissingSchemaError(sr.error.message)) throw new Error(`load scans: ${sr.error.message}`);

  // jobs per portal (tolerant of the column not existing yet)
  const perPortal = new Map<string, { n: number; last: string | null }>();
  const jr = await db().from("jobs").select("portal,found_at").limit(20000);
  if (!jr.error) {
    for (const r of jr.data as { portal: string | null; found_at: string }[]) {
      const k = r.portal ?? "unknown";
      const cur = perPortal.get(k) ?? { n: 0, last: null };
      cur.n++;
      if (!cur.last || r.found_at > cur.last) cur.last = r.found_at;
      perPortal.set(k, cur);
    }
  }

  const hasConfig = (def: IntegrationDef) =>
    def.needsConfig === "greenhouse_boards" ? discovery.greenhouse_boards.length > 0 : def.needsConfig === "lever_companies" ? discovery.lever_companies.length > 0 : def.needsConfig === "other_boards" ? ((discovery.ashby_orgs ?? []).length + (discovery.workable_accounts ?? []).length + (discovery.recruitee_companies ?? []).length + Object.values(discovery.watch ?? {}).flat().length > 0) : def.needsConfig === "apify_actors" ? (discovery.apify_actors ?? []).some((a) => a.enabled) : true;

  const integrations: IntegrationView[] = INTEGRATIONS.map((def) => ({
    def,
    status: deriveStatus(def, states.get(def.id), isComplete(def.id, sources), hasConfig(def)),
    state: states.get(def.id),
    sources: sources[def.id] ?? {},
    recentScans: scans.filter((s) => s.integration === def.id).slice(0, 6),
  }));
  const statusOf = (id: IntegrationId) => integrations.find((i) => i.def.id === id)?.status ?? "needs_setup";

  const portals: PortalView[] = PORTALS.map((def) => {
    const seen = perPortal.get(def.key);
    const d = derivePortalStatus(def, statusOf, seen?.n ?? 0);
    return { def, status: d.status, note: d.note, jobs: seen?.n ?? 0, lastSeen: seen?.last ?? null };
  });
  const otherPortals = [...perPortal].filter(([k]) => !PORTALS.some((p) => p.key === k) && k !== "unknown" && k !== "manual").map(([key, v]) => ({ key, jobs: v.n, lastSeen: v.last }));

  return { integrations, portals, otherPortals, schemaMissing, totalJobs: [...perPortal.values()].reduce((n, v) => n + v.n, 0) };
}
