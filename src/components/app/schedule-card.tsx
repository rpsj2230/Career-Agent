"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BLANK_SCHEDULE, DAY_NAMES, FREQUENCIES, FREQUENCY_LABEL, MODE_LABEL, SCHEDULE_MODES, type ScheduleConfig } from "@/lib/schedule";
import { toast } from "sonner";
import { call } from "./api";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type ScheduleView = ScheduleConfig & {
  id?: string; paused: boolean; describe: string; nextRun: string; lastRun: string; lastStatus: string | null;
};
type Opt = { key: string; label: string };

function toggle<T>(list: T[], v: T): T[] { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }

/** Create (no id) or edit/pause/delete (with id) one schedule. */
export function ScheduleForm({ initial, id, countries, integrations, zones, onDone }: {
  initial: ScheduleConfig; id?: string; countries: Opt[]; integrations: Opt[]; zones: string[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [s, setS] = useState<ScheduleConfig>(initial);
  const set = <K extends keyof ScheduleConfig>(k: K, v: ScheduleConfig[K]) => setS((p) => ({ ...p, [k]: v }));
  async function save() {
    const ok = await call(id ? `/api/schedules/${id}` : "/api/schedules", id ? "PUT" : "POST", s, id ? "Schedule saved" : "Schedule created");
    if (ok) { router.refresh(); onDone?.(); if (!id) setS(BLANK_SCHEDULE); }
  }
  const applies = s.mode === "scan_prepare_apply";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-1"><Label htmlFor={`n-${id ?? "new"}`}>Name</Label><Input id={`n-${id ?? "new"}`} value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Morning run" /></div>
      <div className="grid gap-1"><Label>What it does</Label>
        <select value={s.mode} onChange={(e) => set("mode", e.target.value as ScheduleConfig["mode"])} className={selectClass}>{SCHEDULE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></div>
      <div className="grid gap-1"><Label>How often</Label>
        <select value={s.frequency} onChange={(e) => set("frequency", e.target.value as ScheduleConfig["frequency"])} className={selectClass}>{FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}</select></div>
      {s.frequency === "every_n_hours" ? (
        <div className="grid gap-1"><Label>Hours between runs</Label><Input type="number" min={1} max={168} value={s.interval_hours ?? ""} onChange={(e) => set("interval_hours", e.target.value === "" ? null : Number(e.target.value))} /></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1"><Label>Time</Label><Input type="time" value={s.time_of_day} onChange={(e) => set("time_of_day", e.target.value)} /></div>
          <div className="grid gap-1"><Label>Time zone</Label>
            <select value={s.timezone} onChange={(e) => set("timezone", e.target.value)} className={selectClass}>{(zones.includes(s.timezone) ? zones : [s.timezone, ...zones]).map((z) => <option key={z}>{z}</option>)}</select></div>
        </div>
      )}
      {s.frequency === "weekly" && (
        <div className="flex flex-wrap items-center gap-1 md:col-span-2" role="group" aria-label="Days of the week">
          {DAY_NAMES.map((d, i) => <Button key={d} type="button" size="sm" variant={s.days.includes(i) ? "default" : "outline"} aria-pressed={s.days.includes(i)} onClick={() => set("days", toggle(s.days, i))}>{d}</Button>)}
        </div>
      )}
      <fieldset className="grid gap-1 md:col-span-2"><legend className="mb-1 text-sm font-medium">Countries <span className="font-normal text-muted-foreground">(none selected = all enabled countries)</span></legend>
        <div className="flex flex-wrap gap-1">{countries.length === 0 ? <span className="text-xs text-muted-foreground">Add countries on the Countries page to limit a schedule to some of them.</span> : countries.map((c) => <Button key={c.key} type="button" size="sm" variant={s.countries.includes(c.key) ? "default" : "outline"} aria-pressed={s.countries.includes(c.key)} onClick={() => set("countries", toggle(s.countries, c.key))}>{c.label}</Button>)}</div></fieldset>
      <fieldset className="grid gap-1 md:col-span-2"><legend className="mb-1 text-sm font-medium">Portals and sources <span className="font-normal text-muted-foreground">(none selected = all connected)</span></legend>
        <div className="flex flex-wrap gap-1">{integrations.map((c) => <Button key={c.key} type="button" size="sm" variant={s.integrations.includes(c.key) ? "default" : "outline"} aria-pressed={s.integrations.includes(c.key)} onClick={() => set("integrations", toggle(s.integrations, c.key))}>{c.label}</Button>)}</div></fieldset>
      {s.mode !== "scan" && <div className="grid gap-1"><Label>Write at most (resumes per run of this schedule)</Label><Input type="number" min={0} max={200} value={s.max_prepare} onChange={(e) => set("max_prepare", Number(e.target.value))} /><span className="text-xs text-muted-foreground">Counts resumes only; nothing is sent by this number. Catch-up rounds (Settings) write more on top, and sending has its own limits (see the box at the top of this page).</span></div>}
      {applies && (
        <>
          <div className="grid gap-1"><Label>Send at most (applications per run of this schedule)</Label><Input type="number" min={0} max={100} value={s.max_apply} onChange={(e) => set("max_apply", Number(e.target.value))} /></div>
          <label className="flex items-start gap-2 text-sm md:col-span-2"><Switch checked={s.require_approval} onCheckedChange={(v) => set("require_approval", v)} />
            <span><b>{s.require_approval ? "Ask me before submitting" : "Submit without asking"}</b><br /><span className="text-muted-foreground">{s.require_approval ? "Applications are prepared and wait on the Applications page until you approve them." : "Only portals that allow automation are submitted automatically; everything else waits for you. Your daily caps still apply."}</span></span></label>
        </>
      )}
      <label className="flex items-center gap-2 text-sm"><Switch checked={s.enabled} onCheckedChange={(v) => set("enabled", v)} /> {s.enabled ? "Enabled" : "Disabled"}</label>
      <div className="flex gap-2 md:col-span-2">
        <Button onClick={save}>{id ? "Save changes" : "Create schedule"}</Button>
        {id && <Button variant="outline" onClick={async () => { if (window.confirm(`Delete "${s.name}"? Past runs and logs stay.`) && (await call(`/api/schedules/${id}`, "DELETE", undefined, "Deleted"))) router.refresh(); }}>Delete</Button>}
      </div>
    </div>
  );
}

export function ScheduleCard({ v, countries, integrations, zones }: { v: ScheduleView; countries: Opt[]; integrations: Opt[]; zones: string[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [running, setRunning] = useState(false);
  const { id, paused, describe, nextRun, lastRun, lastStatus, ...config } = v;
  const state = !v.enabled ? "Disabled" : paused ? "Paused" : "Active";
  return (
    <Card className={v.enabled && !paused ? "" : "opacity-80"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">{v.name} <Badge variant={state === "Active" ? "default" : "outline"}>{state}</Badge></CardTitle>
            <CardDescription>{describe} · {MODE_LABEL[v.mode]}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!v.enabled || running} onClick={async () => {
              setRunning(true);
              const r = await call<{ note?: string }>(`/api/schedules/${id}/run`, "POST");
              setRunning(false);
              if (r) { toast.success(r.note ?? "Started"); router.refresh(); }
            }} title="Starts this schedule immediately (search, score, prepare, and apply if it is set to) instead of waiting for its time. It runs in the background on GitHub; the banner at the top of this page shows its progress.">{running ? "Starting..." : "Run this schedule now"}</Button>
            <Button size="sm" variant="outline" onClick={async () => { if (await call(`/api/schedules/${id}`, "PATCH", { paused: !paused }, paused ? "Resumed" : "Paused")) router.refresh(); }} disabled={!v.enabled}>{paused ? "Resume" : "Pause"}</Button>
            <Button size="sm" variant="outline" onClick={() => setEdit((e) => !e)}>{edit ? "Close" : "Edit"}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-1 md:grid-cols-3">
          <div><span className="text-muted-foreground">Next run: </span>{state === "Active" ? nextRun : "not scheduled"}</div>
          <div><span className="text-muted-foreground">Last run: </span>{lastRun}{lastStatus ? ` (${lastStatus})` : ""}</div>
          <div><span className="text-muted-foreground">Scope: </span>{v.countries.length ? v.countries.map((c) => c.toUpperCase()).join(", ") : "all countries"}; {v.integrations.length ? v.integrations.join(", ") : "all connected portals"}</div>
        </div>
        {v.mode === "scan_prepare_apply" && <p className="text-muted-foreground">Submits up to {v.max_apply} per run. {v.require_approval ? "Waits for your approval first." : "Submits automatically where the portal allows it."}</p>}
        <p className="text-xs text-muted-foreground">Every time this schedule ran, with its results, is listed under <a className="underline" href="#run-history">Run history</a> below.</p>
        {edit && <ScheduleForm initial={config} id={id} countries={countries} integrations={integrations} zones={zones} onDone={() => setEdit(false)} />}
      </CardContent>
    </Card>
  );
}

/** One click: a sensible daily schedule that finds, scores and prepares, then waits for your approval. */
export function CreateRecommendedSchedule({ timezone }: { timezone: string }) {
  const router = useRouter();
  return (
    <Button onClick={async () => { if (await call("/api/schedules", "POST", { ...BLANK_SCHEDULE, name: "Daily search and prepare", time_of_day: "09:00", timezone }, "Schedule created")) router.refresh(); }}>
      Create the recommended schedule
    </Button>
  );
}
