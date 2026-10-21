"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

/** The two routing choices that can be changed from the app. */
export function WorkersControls({ initial }: { initial: { enabled: boolean; fallback_minutes: number } }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [minutes, setMinutes] = useState(String(initial.fallback_minutes));
  async function save(next: { enabled: boolean; minutes: string }) {
    const m = Math.max(5, Math.min(1440, Math.round(Number(next.minutes) || 90)));
    const r = await call("/api/settings", "PUT", { key: "cloud_assist", value: { enabled: next.enabled, fallback_minutes: m } }, "Saved");
    if (r) { setMinutes(String(m)); router.refresh(); }
  }
  return (
    <div className="grid gap-3 text-sm">
      <label className="flex items-start gap-3">
        <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); void save({ enabled: v, minutes }); }} className="mt-0.5" />
        <span><b>{enabled ? "Cloud workers take employers' own pages first" : "Cloud workers are off"}</b><br /><span className="text-muted-foreground">On: GitHub (and the always-on machine, if you set one up) apply on employers&apos; own pages, and your computer only takes over what they leave. Off: your computer does everything.</span></span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="fallback" className="font-medium">Your computer steps in after</label>
        <Input id="fallback" className="h-8 w-24" type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={!enabled} />
        <span>minutes</span>
        <Button size="sm" variant="outline" disabled={!enabled} onClick={() => save({ enabled, minutes })}>Save</Button>
        <span className="text-xs text-muted-foreground">If the cloud workers have not taken an employer page by then (down, busy or out of time), your computer does it. 5 to 1440.</span>
      </div>
    </div>
  );
}
