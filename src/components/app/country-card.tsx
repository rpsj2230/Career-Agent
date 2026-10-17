"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { COUNTRIES, countryInfo, defaultCurrency } from "@/lib/countries";
import { defaultPref, parseList, queriesPerSource, REMOTE_LABEL, REMOTE_OPTIONS, WORK_AUTH, type CountryPref } from "@/lib/country-prefs";
import { STYLES, styleFor } from "@/lib/tailor/template";
import { AutofillButton } from "./autofill-button";
import { call } from "./api";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))].sort();

export function AddCountry({ available }: { available: { code: string; name: string }[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [custom, setCustom] = useState("");
  const chosen = (custom.trim().toLowerCase() || code).toLowerCase();
  const valid = /^[a-z]{2}$/.test(chosen);
  async function add() {
    if (!valid) return;
    const ok = await call("/api/country-prefs", "PUT", defaultPref(chosen, defaultCurrency(chosen) ?? null), "Country added. Fill in its criteria below.");
    if (ok) { setCode(""); setCustom(""); router.refresh(); }
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">Add a country
        <select value={code} onChange={(e) => setCode(e.target.value)} className={selectClass}>
          <option value="">Choose...</option>
          {available.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">or any other country (two-letter code, e.g. KR)
        <Input value={custom} maxLength={2} onChange={(e) => setCustom(e.target.value)} className="w-24 uppercase" placeholder="KR" aria-label="Other country code" />
      </label>
      <Button onClick={add} disabled={!valid}>Add</Button>
    </div>
  );
}

export function CountryCard({ pref, profileTitles, templates, suggested = [] }: { pref: CountryPref; profileTitles: string[]; templates: Record<string, string>; suggested?: { title: string; count: number }[] }) {
  const router = useRouter();
  const info = countryInfo(pref.country);
  const [enabled, setEnabled] = useState(pref.enabled);
  const [titles, setTitles] = useState(pref.titles.join(", "));
  const [industries, setIndustries] = useState(pref.industries.join(", "));
  const [locations, setLocations] = useState(pref.locations.join(", "));
  const [remote, setRemote] = useState<CountryPref["remote"]>(pref.remote);
  const [min, setMin] = useState(pref.salary_min?.toString() ?? "");
  const [max, setMax] = useState(pref.salary_max?.toString() ?? "");
  const [currency, setCurrency] = useState(pref.currency ?? defaultCurrency(pref.country) ?? "");
  const [auth, setAuth] = useState(pref.work_authorisation ?? "");
  const [notes, setNotes] = useState(pref.notes ?? "");
  const [style, setStyle] = useState(templates[pref.country] ?? "");

  const body = (): CountryPref => ({
    country: pref.country, enabled, titles: parseList(titles), industries: parseList(industries), locations: parseList(locations), remote,
    salary_min: min.trim() === "" ? null : Number(min), salary_max: max.trim() === "" ? null : Number(max),
    currency: currency || null, work_authorisation: (auth || null) as CountryPref["work_authorisation"], notes: notes.trim() || null,
  });
  const q = queriesPerSource(body());

  async function save() {
    if (!(await call("/api/country-prefs", "PUT", body(), `${info?.name ?? pref.country} saved`))) return;
    const next = { ...templates }; if (style) next[pref.country] = style; else delete next[pref.country];
    if (JSON.stringify(next) !== JSON.stringify(templates)) await call("/api/settings", "PUT", { key: "resume_templates", value: next }, "Resume style saved");
    router.refresh();
  }
  async function remove() {
    if (window.confirm(`Remove ${info?.name ?? pref.country}? Jobs already found stay.`) && (await call(`/api/country-prefs?country=${pref.country}`, "DELETE", undefined, "Removed"))) router.refresh();
  }

  return (
    <Card className={enabled ? "" : "opacity-70"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">{info?.name ?? pref.country.toUpperCase()} <Badge variant="outline">{pref.country.toUpperCase()}</Badge></CardTitle>
            <CardDescription>About {q} search{q === 1 ? "" : "es"} per source on each scan ({titles.trim() ? parseList(titles).length : 0} title(s) x {Math.max(1, parseList(locations).length)} location(s)).</CardDescription>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} /> {enabled ? "Searching" : "Paused"}</label>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1 md:col-span-2">
          <Label htmlFor={`t-${pref.country}`}>Target job titles</Label>
          <Textarea id={`t-${pref.country}`} rows={2} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Product Manager, Senior Product Manager" />
          {suggested.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs"><span className="text-muted-foreground">Found in your matches:</span>
              {suggested.map((t) => <button type="button" key={t.title} onClick={() => setTitles(parseList(`${titles}, ${t.title}`).join(", "))} title={`${t.count} matching jobs had this title`}><Badge variant="outline">+ {t.title} ({t.count})</Badge></button>)}</div>
          )}
          {profileTitles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs"><span className="text-muted-foreground">From your profile:</span>
              {profileTitles.map((t) => <button type="button" key={t} onClick={() => setTitles(parseList(`${titles}, ${t}`).join(", "))}><Badge variant="secondary">+ {t}</Badge></button>)}</div>
          )}
        </div>
        <div className="grid gap-1"><Label htmlFor={`i-${pref.country}`}>Industries</Label><Input id={`i-${pref.country}`} value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder="Fintech, SaaS, Healthcare" /></div>
        <div className="grid gap-1"><Label htmlFor={`l-${pref.country}`}>Preferred locations</Label><Input id={`l-${pref.country}`} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder={info?.code === "sg" ? "Singapore" : info?.code === "in" ? "Bengaluru, Mumbai, Pune" : "City names"} /></div>
        <div className="grid gap-1"><Label htmlFor={`r-${pref.country}`}>Remote work</Label>
          <select id={`r-${pref.country}`} value={remote} onChange={(e) => setRemote(e.target.value as CountryPref["remote"])} className={selectClass}>{REMOTE_OPTIONS.map((o) => <option key={o} value={o}>{REMOTE_LABEL[o]}</option>)}</select></div>
        <div className="grid gap-1"><Label htmlFor={`w-${pref.country}`}>Work authorisation</Label>
          <select id={`w-${pref.country}`} value={auth} onChange={(e) => setAuth(e.target.value)} className={selectClass}><option value="">Not set</option>{WORK_AUTH.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 md:col-span-2">
          <div className="grid gap-1"><Label htmlFor={`min-${pref.country}`}>Minimum salary (per year)</Label><Input id={`min-${pref.country}`} type="number" min={0} step={1000} value={min} onChange={(e) => setMin(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor={`max-${pref.country}`}>Maximum (optional)</Label><Input id={`max-${pref.country}`} type="number" min={0} step={1000} value={max} onChange={(e) => setMax(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor={`c-${pref.country}`}>Currency</Label>
            <select id={`c-${pref.country}`} value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}><option value="">-</option>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="grid gap-1 md:col-span-2"><Label htmlFor={`s-${pref.country}`}>Resume style for this country</Label>
          <select id={`s-${pref.country}`} value={style} onChange={(e) => setStyle(e.target.value)} className={selectClass}><option value="">Automatic ({styleFor(pref.country).label})</option>{STYLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          <span className="text-xs text-muted-foreground">The layout is the same every time; this sets the page size, spelling, the summary heading and how many bullets each role shows. Your expected salary and visa answers for this country come from the fields above.</span></div>
        <div className="grid gap-1 md:col-span-2"><Label htmlFor={`n-${pref.country}`}>Other criteria for this country</Label><Textarea id={`n-${pref.country}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. avoid startups under 20 people; prefer companies that sponsor employment passes" /></div>
        <div className="flex gap-2 md:col-span-2"><Button onClick={save}>Save {info?.name ?? pref.country}</Button><AutofillButton scope="country" country={pref.country} label="Fill empty fields from my profile" /><Button variant="outline" onClick={remove}>Remove</Button></div>
      </CardContent>
    </Card>
  );
}
