"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

type Discovery = { countries: string[]; roles: string[]; greenhouse_boards: string[]; lever_companies: string[]; max_age_days: number };
type Caps = { daily_total: number; daily_linkedin: number; weekly_linkedin: number; linkedin_automation_enabled: boolean };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SettingsForm({ discovery, threshold, caps }: { discovery: Discovery; threshold: number; caps: Caps }) {
  const router = useRouter();
  const [d, setD] = useState({ ...discovery, countries: discovery.countries.join(", "), roles: discovery.roles.join(", "), greenhouse_boards: discovery.greenhouse_boards.join(", "), lever_companies: discovery.lever_companies.join(", ") });
  const [t, setT] = useState(threshold);
  const [c, setC] = useState(caps);
  const refresh = () => router.refresh();

  const saveDiscovery = async () => { if (await call("/api/settings", "PUT", { key: "discovery", value: { countries: csv(d.countries), roles: csv(d.roles), greenhouse_boards: csv(d.greenhouse_boards), lever_companies: csv(d.lever_companies), max_age_days: Number(d.max_age_days) } }, "Discovery settings saved")) refresh(); };
  const saveScoring = async () => { if (await call("/api/settings", "PUT", { key: "scoring", value: { threshold: Number(t) } }, "Threshold saved")) refresh(); };
  const saveCaps = async () => { if (await call("/api/settings", "PUT", { key: "caps", value: { ...c, daily_total: Number(c.daily_total), daily_linkedin: Number(c.daily_linkedin), weekly_linkedin: Number(c.weekly_linkedin) } }, "Limits saved")) refresh(); };
  const num = (v: number, set: (n: number) => void, id: string) => <Input id={id} type="number" value={v} onChange={(e) => set(Number(e.target.value))} />;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Job discovery</CardTitle><CardDescription>Blank countries or roles fall back to your profile preferences. Greenhouse board tokens and Lever company slugs come from the careers-page URL (boards.greenhouse.io/<b>token</b>, jobs.lever.co/<b>slug</b>).</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1"><Label htmlFor="c">Countries (ISO codes)</Label><Input id="c" value={d.countries} placeholder="in, sg, ae" onChange={(e) => setD({ ...d, countries: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="r">Roles</Label><Input id="r" value={d.roles} placeholder="Product Manager, Business Analyst" onChange={(e) => setD({ ...d, roles: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="g">Greenhouse boards</Label><Input id="g" value={d.greenhouse_boards} placeholder="razorpay, postman" onChange={(e) => setD({ ...d, greenhouse_boards: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="l">Lever companies</Label><Input id="l" value={d.lever_companies} placeholder="cred, meesho" onChange={(e) => setD({ ...d, lever_companies: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="age">Ignore jobs older than (days)</Label>{num(d.max_age_days, (n) => setD({ ...d, max_age_days: n }), "age")}</div>
          <div className="md:col-span-2"><Button onClick={saveDiscovery}>Save discovery</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Fit threshold</CardTitle><CardDescription>Jobs scoring below this are skipped (with the reason kept) and never reach your queue.</CardDescription></CardHeader>
        <CardContent className="flex items-end gap-3"><div className="grid gap-1"><Label htmlFor="th">Minimum score (0-100)</Label>{num(t, setT, "th")}</div><Button onClick={saveScoring}>Save</Button></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Application limits</CardTitle><CardDescription>Caps apply to automated submissions only. When a cap is reached the package is prepared for you to submit by hand; nothing is dropped.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1"><Label htmlFor="dt">Automated per day (all sites)</Label>{num(c.daily_total, (n) => setC({ ...c, daily_total: n }), "dt")}</div>
          <div className="grid gap-1"><Label htmlFor="dl">LinkedIn per day</Label>{num(c.daily_linkedin, (n) => setC({ ...c, daily_linkedin: n }), "dl")}</div>
          <div className="grid gap-1"><Label htmlFor="wl">LinkedIn per week</Label>{num(c.weekly_linkedin, (n) => setC({ ...c, weekly_linkedin: n }), "wl")}</div>
          <label className="flex items-center gap-2 text-sm md:col-span-3"><Switch checked={c.linkedin_automation_enabled} onCheckedChange={(v) => setC({ ...c, linkedin_automation_enabled: v })} /> Allow automated LinkedIn Easy Apply</label>
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
