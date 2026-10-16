import Link from "next/link";
import { AddCountry, CountryCard } from "@/components/app/country-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { COUNTRIES } from "@/lib/countries";
import { listCountryPrefs } from "@/lib/country-prefs-store";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CountriesPage() {
  const [{ rows, missing }, profile, discovery] = await Promise.all([listCountryPrefs(), getProfile(), getSetting("discovery")]);
  const have = new Set(rows.map((r) => r.country));
  const available = COUNTRIES.filter((c) => !have.has(c.code)).map((c) => ({ code: c.code, name: c.name }));
  const profileTitles = [...new Set(profile.experience.map((e) => e.title.trim()).filter(Boolean))].slice(0, 6);
  const enabled = rows.filter((r) => r.enabled).length;

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
      <AddCountry available={available} />
      <div className="grid gap-4">
        {rows.map((r) => <CountryCard key={r.country} pref={r} profileTitles={profileTitles} />)}
      </div>
    </div>
  );
}
