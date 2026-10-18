"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

export type Pause = { paused: boolean; since: string; note: string };

/** One switch to stop everything that runs by itself, for example once you have found the job. Nothing is deleted; switch it off to continue. */
export function PauseCard({ initial }: { initial: Pause }) {
  const router = useRouter();
  const [on, setOn] = useState(initial.paused);
  async function flip(v: boolean) {
    setOn(v);
    const r = await call("/api/settings", "PUT", { key: "automation_pause", value: { paused: v, since: v ? new Date().toISOString() : "", note: "" } }, v ? "Everything is paused" : "Automation resumed");
    if (!r) setOn(!v); else router.refresh();
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
          <span><b>{on ? "Paused: nothing runs by itself" : "Running normally"}</b>{on && initial.since ? <><br /><span className="text-muted-foreground">Paused since {new Date(initial.since).toLocaleString()}.</span></> : null}</span>
        </label>
      </CardContent>
    </Card>
  );
}
