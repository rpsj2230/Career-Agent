"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RecheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function recheck() {
    setBusy(true);
    try {
      const res = await fetch("/api/system/recheck", { method: "POST" });
      const data = await res.json();
      if (data.ok) toast.success("Database is up to date");
      else toast.error(data.unreachable ? `Check failed: ${data.unreachable}` : `Still missing ${data.problems.length} item(s)`);
      router.refresh();
    } catch {
      toast.error("Could not re-check");
    } finally {
      setBusy(false);
    }
  }
  return <Button variant="outline" onClick={recheck} disabled={busy}>{busy ? "Checking..." : "Re-check now"}</Button>;
}
