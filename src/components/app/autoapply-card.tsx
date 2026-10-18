"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { call } from "./api";

/** The master switch for anything that submits without you pressing a button. Saves the moment it is flipped. */
export type HandsFreeCaps = { daily_total: number; daily_linkedin: number; weekly_linkedin: number; linkedin_automation_enabled: boolean; local_auto_enabled?: boolean; company_cooldown_days?: number };

export function AutoApplyCard({ enabled, caps }: { enabled: boolean; caps: HandsFreeCaps }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [hands, setHands] = useState(!!caps.local_auto_enabled);
  async function flipHands(v: boolean) {
    setHands(v);
    if (!(await call("/api/settings", "PUT", { key: "caps", value: { ...caps, local_auto_enabled: v, company_cooldown_days: caps.company_cooldown_days ?? 14 } }, v ? "Hands-free is on" : "Hands-free is off"))) setHands(!v);
    else router.refresh();
  }
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
        <label className="mt-4 flex items-start gap-3 border-t pt-4 text-sm">
          <Switch checked={hands} onCheckedChange={flipHands} disabled={!on} className="mt-0.5" />
          <span><b>Hands-free: let the apply assistant on my computer press Submit by itself</b> {hands && on ? <Badge className="bg-emerald-600 text-white">On</Badge> : <Badge variant="secondary">Off</Badge>}<br />
            <span className="text-muted-foreground">For LinkedIn, Naukri, Indeed and similar sites that need your sign-in. It works within the daily limits (Settings, Application limits) and stops at any CAPTCHA or question it cannot answer; those stay for you. {on ? "The assistant must be running on your computer (see Applications, Apply assistant)." : "Switch Auto-Apply on first."} Portals can restrict automated applying; the risk of a warning or block on an account is yours.</span></span>
        </label>
      </CardContent>
    </Card>
  );
}
