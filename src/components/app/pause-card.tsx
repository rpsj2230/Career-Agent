"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

/** How long a pause can last before it resumes by itself. */
export const PAUSE_CHOICES = [
  { label: "10 min", minutes: 10 }, { label: "30 min", minutes: 30 }, { label: "1 hour", minutes: 60 }, { label: "4 hours", minutes: 240 },
  { label: "8 hours", minutes: 480 }, { label: "1 day", minutes: 1440 }, { label: "1 week", minutes: 10_080 }, { label: "1 month (30 days)", minutes: 43_200 },
] as const;

export type Pause = { paused: boolean; since: string; until?: string; note: string };

/** One switch to stop everything that runs by itself, for example once you have found the job. Nothing is deleted; switch it off to continue. */
export function PauseCard({ initial }: { initial: Pause }) {
  const router = useRouter();
  const [loadedAt] = useState(() => Date.now());
  const timed = !!initial.until && new Date(initial.until).getTime() > loadedAt;
  const [on, setOn] = useState(initial.paused && (!initial.until || timed));
  async function flip(v: boolean) {
    setOn(v);
    const r = await call("/api/settings", "PUT", { key: "automation_pause", value: { paused: v, since: v ? new Date().toISOString() : "", note: "" } }, v ? "Everything is paused" : "Automation resumed");
    if (!r) setOn(!v); else router.refresh();
  }
  async function pauseFor(choice: (typeof PAUSE_CHOICES)[number]) {
    const minutes = choice.minutes;
    const start = new Date();
    const until = new Date(start.getTime() + minutes * 60_000).toISOString();
    const r = await call("/api/settings", "PUT", { key: "automation_pause", value: { paused: true, since: start.toISOString(), until, note: "" } }, `Paused for ${choice.label}; it resumes by itself`);
    if (r) { setOn(true); router.refresh(); }
  }
  return (
    <Card className={on ? "border-amber-500" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Pause everything {on ? <Badge className="bg-amber-500 text-white">Paused</Badge> : <Badge variant="secondary">Running</Badge>}</CardTitle>
        <CardDescription>
          Found a job, or want a break? While this is on, nothing runs by itself: no scheduled runs, no searching, no scoring or preparing in the background, no automatic approving or applying (cloud or assistant), and no automatic emails to employers.
          Your data stays as it is, and the buttons you press yourself still work. Switch it off to carry on where it stopped.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={on} onCheckedChange={flip} className="mt-0.5" />
          <span><b>{on ? "Paused: nothing runs by itself" : "Running normally"}</b>{on && initial.since ? <><br /><span className="text-muted-foreground">Paused since {new Date(initial.since).toLocaleString()}{timed ? `; it resumes by itself on ${new Date(initial.until!).toLocaleString()}` : "; it stays paused until you switch it off"}.</span></> : null}</span>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Pause, and resume by itself after:</span>
          {PAUSE_CHOICES.map((c) => <Button key={c.minutes} size="sm" variant="outline" onClick={() => pauseFor(c)}>{c.label}</Button>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">A pause stops new work at once: the assistant stops after the application it is on, and background runs do not start. A run already in progress on GitHub finishes its current step (to cancel it now: GitHub, Actions, Cancel workflow).</p>
      </CardContent>
    </Card>
  );
}
