import { INTEGRATIONS, type ConnectionStatus, type Cost, type IntegrationId } from "./catalog";

/** What each connected source can contribute for one country, and where the gaps are. Pure, so it can be tested. */
export type SourceRole = "search" | "feed" | "alerts" | "boards";
export type CoverageSource = { id: IntegrationId; name: string; role: SourceRole; cost: Cost; status: ConnectionStatus; usable: boolean };
export type Coverage = { country: string; sources: CoverageSource[]; level: "good" | "partial" | "thin"; advice: string[] };

const ROLE: Partial<Record<IntegrationId, SourceRole>> = { mailbox: "alerts", greenhouse: "boards", lever: "boards", remotive: "feed", remoteok: "feed", jobicy: "feed", arbeitnow: "feed" };

/** Portals' own sites that are worth setting an alert on, per country, when nothing else covers them. */
const ALERT_PORTALS: Record<string, string> = {
  in: "Naukri, Foundit, Shine, LinkedIn and Indeed", sg: "JobStreet, LinkedIn and Indeed", au: "SEEK, LinkedIn and Indeed", ca: "LinkedIn and Indeed",
  us: "LinkedIn and Indeed", ae: "Bayt, Naukrigulf, GulfTalent and LinkedIn", sa: "Bayt, Naukrigulf, GulfTalent and LinkedIn", qa: "Bayt, Naukrigulf, GulfTalent and LinkedIn",
  kw: "Bayt, Naukrigulf and LinkedIn", bh: "Bayt, Naukrigulf and LinkedIn", om: "Bayt, Naukrigulf and LinkedIn",
};

export function coverageFor(country: string, status: (id: IntegrationId) => ConnectionStatus, apifyConfigured: boolean): Coverage {
  const c = country.toLowerCase();
  const sources: CoverageSource[] = [];
  for (const def of INTEGRATIONS) {
    if (!def.available || !def.discovers) continue;
    const serves = def.countries === "all" || def.countries.includes(c);
    if (!serves) continue;
    const st = status(def.id);
    const usable = (st === "ok" || st === "ready") && (def.id !== "apify" || apifyConfigured);
    sources.push({ id: def.id, name: def.name, role: ROLE[def.id] ?? "search", cost: def.cost, status: st, usable });
  }
  // a country-wide view needs searchable sources (APIs, scrapers) or alerts; remote feeds only add remote roles
  const searching = sources.filter((s) => s.usable && s.role === "search");
  const alerts = sources.filter((s) => s.usable && s.role === "alerts");
  const score = searching.length + (alerts.length ? 1 : 0);
  const level = score >= 3 ? "good" : score >= 2 ? "partial" : "thin";

  const advice: string[] = [];
  const idle = (id: IntegrationId) => sources.some((s) => s.id === id && !s.usable);
  const absent = (id: IntegrationId) => !sources.some((s) => s.id === id);
  if (absent("adzuna")) advice.push(`Adzuna does not cover ${c.toUpperCase()}, so rely on JSearch (Google for Jobs), job-alert emails${ALERT_PORTALS[c] ? ` from ${ALERT_PORTALS[c]}` : ""}, and the company boards you list.`);
  else if (idle("adzuna")) advice.push("Connect Adzuna (free key): it covers this country directly.");
  if (idle("jsearch")) advice.push("Connect JSearch (free RapidAPI plan): it indexes LinkedIn, Indeed, Glassdoor and local portals for this country.");
  if (c === "sg" && idle("mcf")) advice.push("MyCareersFuture is free and covers Singapore's government portal: enable it on the Portals page.");
  if (idle("mailbox")) advice.push(`Connect the job-alert mailbox (free) and turn on alerts${ALERT_PORTALS[c] ? ` on ${ALERT_PORTALS[c]}` : " on the portals you use"}: this is how portals with no API reach you.`);
  if (!apifyConfigured && level !== "good") advice.push("Optional: Apify's free monthly credit can read LinkedIn and others for this country (set a monthly budget so it stays free).");
  return { country: c, sources, level, advice };
}

export const COVERAGE_NOTE: Record<Coverage["level"], string> = {
  good: "Good: several independent sources, duplicates are merged",
  partial: "Partial: add one more source below for fuller coverage",
  thin: "Thin: connect more sources, otherwise many jobs here will be missed",
};
