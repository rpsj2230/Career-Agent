"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { call } from "./api";

/** Write a new resume and cover letter for this application, optionally with your own instructions, then approve it again. */
export function RegenerateCard({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const sent = status === "submitted";
  const sending = status === "approved" || status === "submitting";

  async function run() {
    if (sent && !window.confirm("This application was already submitted. A new version means you may apply to the same job a second time, which some employers reject as a duplicate. Continue?")) return;
    setBusy(true);
    const r = await call<{ note?: string }>(`/api/applications/${id}/regenerate`, "POST", { guidance: guidance.trim() || undefined, confirmSubmitted: sent || undefined });
    setBusy(false);
    if (r) { toast.success(r.note ?? "Started"); router.refresh(); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Write a new resume for this application</CardTitle>
        <CardDescription>
          Not happy with the resume or cover letter? This writes new ones from your profile and this job, keeps the old versions in the history, and puts the application back to <b>Pending approval</b>.
          Then press <b>Approve</b> to apply with the new version. {sent ? "This application was already submitted, so applying again may count as a duplicate." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="regen-guidance">Your instructions (optional)</label>
        <Textarea id="regen-guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={600} rows={2} disabled={busy || sending}
          placeholder="For example: stress my payments and SQL experience; keep the summary to three sentences." />
        <p className="text-xs text-muted-foreground">Instructions steer emphasis and tone only. Everything written is still checked against your profile, so nothing can be invented.</p>
        <div><Button onClick={run} disabled={busy || sending}>{busy ? "Starting…" : sending ? "Being sent now" : sent ? "Write a new version and apply again" : "Write a new resume"}</Button></div>
      </CardContent>
    </Card>
  );
}
