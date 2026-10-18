"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

export type AutoPrepare = { enabled: boolean; per_run: number };

/** Matched jobs get their resume and cover letter written by themselves, a few every hour, so you only review and approve. */
export function AutoPrepareCard({ initial }: { initial: AutoPrepare }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic preparing and backlog clearing</CardTitle>
        <CardDescription>
          Every hour the app scores any jobs that are waiting and writes the resume, cover letter (and employer email) for good matches, following the rules of your active schedule, so applications are ready for you to approve without pressing Prepare.
          The batch is limited so the free AI quotas last.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} className="mt-0.5" /><span><b>Prepare matched jobs automatically</b><br /><span className="text-muted-foreground">Off: matched jobs wait until you press Prepare (or your schedule prepares them at its own time).</span></span></label>
        <div className="grid gap-1 md:max-w-xs"><label className="text-sm font-medium" htmlFor="ap-n">Most resumes prepared per hourly round</label><Input id="ap-n" type="number" min={0} max={40} value={s.per_run} onChange={(e) => setS({ ...s, per_run: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} disabled={!s.enabled} /></div>
        <div><Button onClick={async () => { if (await call("/api/settings", "PUT", { key: "auto_prepare", value: s }, "Saved")) router.refresh(); }}>Save</Button></div>
      </CardContent>
    </Card>
  );
}
