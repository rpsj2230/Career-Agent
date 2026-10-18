"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ActionButton } from "./action-button";
import { call } from "./api";

type D = { enabled: boolean; hour: number; telegram: boolean; email: boolean; to: string };

/** The morning message: yesterday's report, what each run did, and the health check. */
export function DeliveryCard({ initial, tz, mailboxUser }: { initial: D; tz: string; mailboxUser: string | null }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const set = <K extends keyof D>(k: K, v: D[K]) => setD((p) => ({ ...p, [k]: v }));
  async function save() { if (await call("/api/settings", "PUT", { key: "delivery", value: d }, "Saved")) router.refresh(); }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily report and health check</CardTitle>
        <CardDescription>
          Once a day you receive what was found, scored, prepared and applied the day before, what each automatic run did, and a health check that says what is working and what is not, with the fix for anything that is not.
          It is sent at the first check after the hour you choose ({tz} time).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-center gap-3 text-sm"><Switch checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} /> Send it every day</label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-3 text-sm"><Switch checked={d.telegram} onCheckedChange={(v) => set("telegram", v)} /> By Telegram <span className="text-xs text-muted-foreground">(needs the Telegram bot set up)</span></label>
          <label className="flex items-center gap-3 text-sm"><Switch checked={d.email} onCheckedChange={(v) => set("email", v)} /> By email <span className="text-xs text-muted-foreground">(uses your connected Gmail mailbox)</span></label>
          <div className="grid gap-1"><Label htmlFor="dl-hour">Send after (hour of the day, 0-23)</Label><Input id="dl-hour" type="number" min={0} max={23} value={d.hour} onChange={(e) => set("hour", Math.min(23, Math.max(0, Number(e.target.value) || 0)))} /></div>
          <div className="grid gap-1"><Label htmlFor="dl-to">Email address</Label><Input id="dl-to" type="email" value={d.to} placeholder={mailboxUser ?? "connect your mailbox on the Job sources page"} onChange={(e) => set("to", e.target.value)} /><span className="text-xs text-muted-foreground">Empty = your connected mailbox address{mailboxUser ? ` (${mailboxUser})` : ""}.</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>Save</Button>
          <ActionButton endpoint="/api/delivery" method="POST" variant="outline" success="Sent">Send it now (test)</ActionButton>
        </div>
      </CardContent>
    </Card>
  );
}
