"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { call } from "./api";

/** The master switch for anything that submits without you pressing a button. Saves the moment it is flipped. */
export function AutoApplyCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  async function flip(v: boolean) {
    setOn(v);
    if (!(await call("/api/settings", "PUT", { key: "autoapply", value: { enabled: v } }, v ? "Auto-Apply is on" : "Auto-Apply is off"))) setOn(!v);
    else router.refresh();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Auto-Apply {on ? <Badge className="bg-emerald-600 text-white">On</Badge> : <Badge variant="secondary">Off</Badge>}</CardTitle>
        <CardDescription>
          The master switch for anything that submits an application without you pressing Approve: schedules set to submit by themselves, and the hands-free apply assistant on your computer.
          While it is off, jobs are still found, scored and prepared, but every application waits on the Applications page for your approval. It is off by default.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={on} onCheckedChange={flip} className="mt-0.5" />
          <span><b>{on ? "Auto-Apply is on" : "Auto-Apply is off"}</b><br /><span className="text-muted-foreground">{on ? "Schedules and the assistant may submit within your daily limits, only for portals that allow automation and only when the documents were verified against your profile. Switch it off at any time; it takes effect on the next application." : "Nothing is submitted until you approve it yourself. Your approvals (button or Telegram) always work."}</span></span>
        </label>
      </CardContent>
    </Card>
  );
}
