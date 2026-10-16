"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { call } from "./api";

/** For jobs that arrived with only a short summary (alert emails): paste the posting's real description. */
export function AddDescription({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const ok = await call(`/api/jobs/${jobId}/description`, "PUT", { description: text }, "Description saved");
    setBusy(false);
    if (ok) { setText(""); router.refresh(); }
  }
  return (
    <div className="grid gap-2">
      <Textarea aria-label="Full job description" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Open the posting, copy the whole description and paste it here" />
      <div><Button onClick={save} disabled={busy || text.trim().length < 80}>Save description</Button></div>
    </div>
  );
}
