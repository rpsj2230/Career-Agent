"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { call } from "./api";

/** Apply again with the same resume and cover letter: puts a sent, failed or waiting application back to Pending approval. */
export function ReapplyCard({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!["submitted", "failed", "needs_input", "assisted_pending"].includes(status)) return null;
  const sent = status === "submitted";
  async function run() {
    if (sent && !window.confirm("This application was already submitted. Applying again may count as a duplicate, which some employers reject. Continue?")) return;
    setBusy(true);
    const r = await call<{ note?: string }>(`/api/applications/${id}`, "POST", { action: "reapply", confirmSubmitted: sent || undefined });
    setBusy(false);
    if (r) { toast.success(r.note ?? "Ready to apply again"); router.refresh(); }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply again</CardTitle>
        <CardDescription>Use the same resume and cover letter once more{status === "failed" ? " (the last attempt failed)" : sent ? " (it was already submitted, so this may count as a duplicate)" : ""}. It goes back to <b>Pending approval</b>, then press <b>Approve</b>. Want different documents? Use <b>Write a new resume</b> below.</CardDescription>
      </CardHeader>
      <CardContent><Button variant="outline" onClick={run} disabled={busy}>{busy ? "Working…" : "Apply again with the same resume"}</Button></CardContent>
    </Card>
  );
}
