"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { COUNTRY_PRESETS, ROLE_PRESETS, toggleCsv } from "@/lib/standard-questions";
import { call } from "./api";

type Discovery = { countries: string[]; roles: string[]; greenhouse_boards: string[]; lever_companies: string[]; ashby_orgs?: string[]; workable_accounts?: string[]; recruitee_companies?: string[]; max_age_days: number; min_rescan_hours?: number };
type Scoring = { threshold: number; min_evidence: number; batch_size: number; routing: boolean; escalate_borderline: boolean; learning: boolean };
type Caps = { daily_total: number; daily_linkedin: number; weekly_linkedin: number; linkedin_automation_enabled: boolean; local_auto_enabled?: boolean; company_cooldown_days?: number };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SettingsForm({ discovery, scoring, caps, tailoring, blocklist, profileTitles }: { discovery: Discovery; scoring: Scoring; caps: Caps; blocklist: { companies: string[]; keywords: string[]; skip_agencies: boolean }; tailoring: { reuse_enabled: boolean; reuse_similarity: number; adapt_similarity: number }; profileTitles: string[] }) {
  const router = useRouter();
  const [d, setD] = useState({ ...discovery, countries: discovery.countries.join(", "), roles: discovery.roles.join(", "), greenhouse_boards: discovery.greenhouse_boards.join(", "), lever_companies: discovery.lever_companies.join(", "), ashby_orgs: (discovery.ashby_orgs ?? []).join(", "), workable_accounts: (discovery.workable_accounts ?? []).join(", "), recruitee_companies: (discovery.recruitee_companies ?? []).join(", ") });
  const [t, setT] = useState(scoring.threshold);
  const [me, setMe] = useState(scoring.min_evidence);
  const [sc, setSc] = useState({ batch_size: scoring.batch_size, routing: scoring.routing, escalate_borderline: scoring.escalate_borderline, learning: scoring.learning });
  const [tl, setTl] = useState(tailoring);
  const [c, setC] = useState(caps);
  const [bl, setBl] = useState({ companies: blocklist.companies.join(", "), keywords: blocklist.keywords.join(", "), skip_agencies: blocklist.skip_agencies });
  const saveBlocklist = async () => { if (await call("/api/settings", "PUT", { key: "blocklist", value: { companies: csv(bl.companies), keywords: csv(bl.keywords), skip_agencies: bl.skip_agencies } }, "Blocklist saved")) refresh(); };
  const refresh = () => router.refresh();

  const saveDiscovery = async () => { if (await call("/api/settings", "PUT", { key: "discovery", value: { countries: csv(d.countries), roles: csv(d.roles), greenhouse_boards: csv(d.greenhouse_boards), lever_companies: csv(d.lever_companies), ashby_orgs: csv(d.ashby_orgs ?? ""), workable_accounts: csv(d.workable_accounts ?? ""), recruitee_companies: csv(d.recruitee_companies ?? ""), max_age_days: Number(d.max_age_days), min_rescan_hours: Number(d.min_rescan_hours ?? 6) } }, "Discovery settings saved")) refresh(); };
  const saveTailoring = async () => { if (await call("/api/settings", "PUT", { key: "tailoring", value: tl }, "Resume memory saved")) refresh(); };
  const saveScoring = async () => { if (await call("/api/settings", "PUT", { key: "scoring", value: { threshold: Number(t), min_evidence: Number(me), ...sc, batch_size: Number(sc.batch_size) } }, "Threshold saved")) refresh(); };
  const saveCaps = async () => { if (await call("/api/settings", "PUT", { key: "caps", value: { ...c, daily_total: Number(c.daily_total), daily_linkedin: Number(c.daily_linkedin), weekly_linkedin: Number(c.weekly_linkedin) } }, "Limits saved")) refresh(); };
  const num = (v: number, set: (n: number) => void, id: string) => <Input id={id} type="number" value={v} onChange={(e) => set(Number(e.target.value))} />;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Job discovery</CardTitle><CardDescription>Tap the chips to add or remove, or type your own. Blank countries or roles fall back to your profile preferences. Greenhouse board tokens and Lever company slugs come from the careers-page URL (boards.greenhouse.io/<b>token</b>, jobs.lever.co/<b>slug</b>).</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="c">Countries (ISO codes)</Label>
            <Input id="c" value={d.countries} placeholder="in, sg, ae" onChange={(e) => setD({ ...d, countries: e.target.value })} />
            <div className="flex flex-wrap gap-1">
              {COUNTRY_PRESETS.map((c) => (
                <button type="button" key={c.code} onClick={() => setD({ ...d, countries: toggleCsv(d.countries, c.code) })}>
                  <Badge variant={csv(d.countries).includes(c.code) ? "default" : "outline"}>{c.name}</Badge>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="r">Roles</Label>
            <Input id="r" value={d.roles} placeholder="Product Manager, Business Analyst" onChange={(e) => setD({ ...d, roles: e.target.value })} />
            <div className="flex flex-wrap gap-1">
              {profileTitles.length > 0 && <span className="self-center text-xs text-muted-foreground">From your profile:</span>}
              {profileTitles.map((r) => (
                <button type="button" key={`p-${r}`} onClick={() => setD({ ...d, roles: toggleCsv(d.roles, r) })}>
                  <Badge variant={csv(d.roles).map((x) => x.toLowerCase()).includes(r.toLowerCase()) ? "default" : "secondary"}>{r}</Badge>
                </button>
              ))}
              {ROLE_PRESETS.map((r) => (
                <button type="button" key={r} onClick={() => setD({ ...d, roles: toggleCsv(d.roles, r) })}>
                  <Badge variant={csv(d.roles).map((x) => x.toLowerCase()).includes(r.toLowerCase()) ? "default" : "outline"}>{r}</Badge>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1"><Label htmlFor="g">Greenhouse boards</Label><Input id="g" value={d.greenhouse_boards} placeholder="razorpay, postman" onChange={(e) => setD({ ...d, greenhouse_boards: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="l">Lever companies</Label><Input id="l" value={d.lever_companies} placeholder="cred, meesho" onChange={(e) => setD({ ...d, lever_companies: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="ash">Ashby organisations</Label><Input id="ash" value={d.ashby_orgs as unknown as string} placeholder="ramp, notion" onChange={(e) => setD({ ...d, ashby_orgs: e.target.value as never })} /></div>
          <div className="grid gap-1"><Label htmlFor="wk">Workable accounts</Label><Input id="wk" value={d.workable_accounts as unknown as string} placeholder="acme, globex" onChange={(e) => setD({ ...d, workable_accounts: e.target.value as never })} /></div>
          <div className="grid gap-1"><Label htmlFor="rc">Recruitee companies</Label><Input id="rc" value={d.recruitee_companies as unknown as string} placeholder="acme, globex" onChange={(e) => setD({ ...d, recruitee_companies: e.target.value as never })} /></div>
          <div className="grid gap-1"><Label htmlFor="age">Ignore jobs older than (days)</Label>{num(d.max_age_days, (n) => setD({ ...d, max_age_days: n }), "age")}</div>
          <div className="grid gap-1"><Label htmlFor="rescan">Do not search the same thing again within (hours)</Label>{num(d.min_rescan_hours ?? 6, (n) => setD({ ...d, min_rescan_hours: n }), "rescan")}<span className="text-xs text-muted-foreground">Saves free-plan quota and time. Each search remembers when it last ran and then asks only for newer jobs. 0 = always search.</span></div>
          <div className="md:col-span-2"><Button onClick={saveDiscovery}>Save discovery</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Fit threshold</CardTitle><CardDescription>Jobs scoring below this are skipped (with the reason kept) and never reach your queue.</CardDescription></CardHeader>
        <CardContent className="flex items-end gap-3"><div className="grid gap-1"><Label htmlFor="th">Minimum score (0-100)</Label>{num(t, setT, "th")}</div><div className="grid gap-1"><Label htmlFor="me">Free pre-check minimum (0-60)</Label>{num(me, setMe, "me")}</div><Button onClick={saveScoring}>Save</Button></CardContent>
        <CardContent className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <div className="grid gap-1"><Label htmlFor="bs">Jobs scored per model call (1-8)</Label>{num(sc.batch_size, (n) => setSc({ ...sc, batch_size: n }), "bs")}<span className="text-xs text-muted-foreground">Several jobs share one call, so your profile is sent once instead of once per job. 1 = one job per call.</span></div>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2"><Switch checked={sc.routing} onCheckedChange={(v) => setSc({ ...sc, routing: v })} /> Fast models for scoring, stronger models for writing</label>
            <label className="flex items-center gap-2"><Switch checked={sc.escalate_borderline} onCheckedChange={(v) => setSc({ ...sc, escalate_borderline: v })} /> Re-check scores close to the threshold with a stronger model</label>
            <label className="flex items-center gap-2"><Switch checked={sc.learning} onCheckedChange={(v) => setSc({ ...sc, learning: v })} /> Learn from my skips, interviews and rejections</label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Blocklist</CardTitle><CardDescription>Jobs matching any of these are skipped for free, before anything else, with the reason kept.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1"><Label htmlFor="blc">Companies (part of the name is enough)</Label><Input id="blc" value={bl.companies} placeholder="acme staffing, globex" onChange={(e) => setBl({ ...bl, companies: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="blk">Words in the title or description</Label><Input id="blk" value={bl.keywords} placeholder="unpaid, commission only, internship" onChange={(e) => setBl({ ...bl, keywords: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm md:col-span-2"><Switch checked={bl.skip_agencies} onCheckedChange={(v) => setBl({ ...bl, skip_agencies: v })} /> Skip jobs posted by recruitment agencies</label>
          <div className="md:col-span-2"><Button onClick={saveBlocklist}>Save blocklist</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Resume memory</CardTitle><CardDescription>Reuse or lightly adapt a resume the agent already wrote and verified for a very similar job, instead of writing a new one. This saves model usage; every resume is still re-checked against your profile.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm md:col-span-3"><Switch checked={tl.reuse_enabled} onCheckedChange={(v) => setTl({ ...tl, reuse_enabled: v })} /> Reuse and adapt past resumes</label>
          <div className="grid gap-1"><Label htmlFor="ru">Reuse as is above (similarity 0-1)</Label>{num(tl.reuse_similarity, (n) => setTl({ ...tl, reuse_similarity: n }), "ru")}</div>
          <div className="grid gap-1"><Label htmlFor="ad">Adapt above (similarity 0-1)</Label>{num(tl.adapt_similarity, (n) => setTl({ ...tl, adapt_similarity: n }), "ad")}</div>
          <div className="md:col-span-3"><Button onClick={saveTailoring}>Save</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Application limits</CardTitle><CardDescription>Caps apply to automated submissions only. When a cap is reached the package is prepared for you to submit by hand; nothing is dropped.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1"><Label htmlFor="dt">Automated per day (all sites)</Label>{num(c.daily_total, (n) => setC({ ...c, daily_total: n }), "dt")}</div>
          <div className="grid gap-1"><Label htmlFor="dl">LinkedIn per day</Label>{num(c.daily_linkedin, (n) => setC({ ...c, daily_linkedin: n }), "dl")}</div>
          <div className="grid gap-1"><Label htmlFor="wl">LinkedIn per week</Label>{num(c.weekly_linkedin, (n) => setC({ ...c, weekly_linkedin: n }), "wl")}</div>
          <div className="grid gap-1"><Label htmlFor="cd">Days to wait before applying again to the same company</Label>{num(c.company_cooldown_days ?? 14, (n) => setC({ ...c, company_cooldown_days: n }), "cd")}<span className="text-xs text-muted-foreground">Applies to automatic approval only; you can always approve by hand. 0 = no wait.</span></div>
          <label className="flex items-center gap-2 text-sm md:col-span-3"><Switch checked={c.linkedin_automation_enabled} onCheckedChange={(v) => setC({ ...c, linkedin_automation_enabled: v })} /> Allow automated LinkedIn Easy Apply</label>
          <label className="flex items-center gap-2 text-sm md:col-span-3"><Switch checked={!!c.local_auto_enabled} onCheckedChange={(v) => setC({ ...c, local_auto_enabled: v })} /> Let the apply assistant on my computer press Submit by itself (hands-free, within the limits above)</label>
          {c.local_auto_enabled && (
            <Alert variant="destructive" className="md:col-span-3">
              <AlertTitle>Portal terms</AlertTitle>
              <AlertDescription>Portals such as LinkedIn, Naukri and Indeed restrict automated applying and can warn, block or ban an account. The assistant runs from your own computer, paces itself, never touches a CAPTCHA or security check and stops at the first one, but the risk is yours. Anything with a question it cannot answer is left for you.</AlertDescription>
            </Alert>
          )}
          {c.linkedin_automation_enabled && (
            <Alert variant="destructive" className="md:col-span-3">
              <AlertTitle>Account risk</AlertTitle>
              <AlertDescription>LinkedIn&apos;s terms prohibit automated applications and can restrict or ban accounts. Keep the caps low. The worker stops immediately if LinkedIn shows a warning or verification step.</AlertDescription>
            </Alert>
          )}
          <div className="md:col-span-3"><Button onClick={saveCaps}>Save limits</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
