import Link from "next/link";
import { AddCountry, CountryCard } from "@/components/app/country-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COVERAGE_NOTE, coverageFor } from "@/lib/integrations/coverage";
import { loadPortalsView } from "@/lib/integrations/view";
import { COUNTRIES } from "@/lib/countries";
import { ensureCountryDefaults, listCountryPrefs } from "@/lib/country-prefs-store";
import { AutofillButton } from "@/components/app/autofill-button";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";
import { loadTitleSuggestions } from "@/lib/jobs/adaptive-store";

export const dynamic = "force-dynamic";

export default async function CountriesPage() {
  // first visit: give each of your countries an entry filled from your profile (once per country; nothing existing is touched)
  const first = await getProfile();
  if (first.experience.length > 0) await ensureCountryDefaults(first).catch(() => []);
  const [{ rows, missing }, profile, discovery, templates, view, apify] = await Promise.all([listCountryPrefs(), getProfile(), getSetting("discovery"), getSetting("resume_templates"), loadPortalsView().catch(() => null), getSetting("apify")]);
  const statusOf = (id: string) => view?.integrations.find((i) => i.def.id === id)?.status ?? "needs_setup";
  const coverage = rows.filter((r) => r.enabled).map((r) => coverageFor(r.country, statusOf as never, apify.actors.some((a) => a.enabled)));
  const have = new Set(rows.map((r) => r.country));
  const available = COUNTRIES.filter((c) => !have.has(c.code)).map((c) => ({ code: c.code, name: c.name }));
  const profileTitles = [...new Set(profile.experience.map((e) => e.title.trim()).filter(Boolean))].slice(0, 6);
  const enabled = rows.filter((r) => r.enabled).length;
  const suggestions = await loadTitleSuggestions(Object.fromEntries(rows.map((r) => [r.country, r.titles]))).catch(() => ({}));

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Countries and job criteria</h1>
        <p className="text-sm text-muted-foreground">Search several countries at once, each with its own titles, locations, remote preference, salary and work-authorisation criteria. {rows.length > 0 ? `${enabled} of ${rows.length} searching.` : ""}</p>
      </div>
      {missing && <Alert variant="destructive"><AlertTitle>Database update needed</AlertTitle><AlertDescription>Country settings cannot be saved until the update is applied. <Link className="underline" href="/system">Open System</Link>.</AlertDescription></Alert>}
      {rows.length === 0 && !missing && (
        <Alert><AlertTitle>Using your general settings</AlertTitle><AlertDescription>No country is configured here yet, so scans use the countries and roles from <Link className="underline" href="/settings">Settings</Link>{discovery.countries.length ? ` (${discovery.countries.map((c) => c.toUpperCase()).join(", ")})` : ""}. Add a country below to give it its own criteria; configured countries take over from those general settings.</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <AddCountry available={available} />
        {profile.experience.length > 0 && <AutofillButton scope="countries" label="Fill empty fields from my profile" />}
      </div>
      {coverage.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Where jobs come from, by country</CardTitle><CardDescription>No single source has every job, so several are used together and duplicates are merged. Free sources are listed first; add the suggestions to fill the gaps.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {coverage.map((c) => (
              <div key={c.country} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2"><b>{COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country.toUpperCase()}</b><Badge variant={c.level === "good" ? "secondary" : c.level === "partial" ? "outline" : "destructive"}>{c.level}</Badge></div>
                <p className="mb-1 text-xs text-muted-foreground">{COVERAGE_NOTE[c.level]}</p>
                <ul className="mb-1 grid gap-0.5 text-xs">{[...c.sources].sort((a, b) => Number(b.usable) - Number(a.usable)).map((s) => <li key={s.id}>{s.usable ? "✓" : "○"} {s.name} <span className="text-muted-foreground">({s.cost.kind === "free" ? "free" : s.cost.kind === "free_tier" ? "free tier" : "free credit"}{s.usable ? "" : ", not connected"})</span></li>)}</ul>
                {c.advice.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{c.advice.map((a) => <li key={a}>{a}</li>)}</ul>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4">
        {rows.map((r) => <CountryCard key={r.country + JSON.stringify(r)} pref={r} profileTitles={profileTitles} templates={templates} suggested={(suggestions as Record<string, { title: string; count: number }[]>)[r.country] ?? []} />)}
      </div>
    </div>
  );
}
