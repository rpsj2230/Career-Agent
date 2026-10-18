"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

export type EmailApply = { enabled: boolean; also_when_listed: boolean; daily_cap: number };

/** Applying by email: for postings that ask for it, and as a second route for postings that list an address. */
export function EmailApplyCard({ initial, mailbox }: { initial: EmailApply; mailbox: string }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Applying by email</CardTitle>
        <CardDescription>
          Some postings say &quot;send your CV to …&quot;, and many list a hiring address. For those the app writes an email with your tailored resume and cover letter attached and a message that explains why you fit the job, and sends it from your own mailbox
          {mailbox ? ` (${mailbox})` : " (connect the mailbox on the Job sources page first; the same Gmail app password is used to send)"} when you approve the application.
          Emails only go to an address that appears in the posting or one you type yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} className="mt-0.5" /><span><b>Write application emails</b><br /><span className="text-muted-foreground">Off: no emails are written or sent.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.also_when_listed} onCheckedChange={(v) => setS({ ...s, also_when_listed: v })} disabled={!s.enabled} className="mt-0.5" /><span><b>Also email when the posting lists an address</b><br /><span className="text-muted-foreground">Applies through the normal route and by email, which gives a second chance of being seen. Postings that only accept email are always emailed.</span></span></label>
        <div className="grid gap-1 md:max-w-xs"><label className="text-sm font-medium" htmlFor="em-cap">Most application emails per day</label><Input id="em-cap" type="number" min={0} max={100} value={s.daily_cap} onChange={(e) => setS({ ...s, daily_cap: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></div>
        <div><Button onClick={async () => { if (await call("/api/settings", "PUT", { key: "email_apply", value: s }, "Saved")) router.refresh(); }}>Save</Button></div>
      </CardContent>
    </Card>
  );
}
