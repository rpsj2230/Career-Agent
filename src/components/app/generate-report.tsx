"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { call } from "./api";

/** Build today's report now (optionally also send it to Telegram). */
export function GenerateReport() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(send: boolean) {
    setBusy(true);
    const r = await call<{ date: string; delivered: boolean }>("/api/reports/daily", "POST", { send }, send ? "Report generated and sent" : "Report generated");
    setBusy(false);
    if (r) router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => run(false)} disabled={busy}>{busy ? "Working..." : "Generate today's report"}</Button>
      <Button variant="outline" onClick={() => run(true)} disabled={busy}>Generate and send to Telegram</Button>
    </div>
  );
}
