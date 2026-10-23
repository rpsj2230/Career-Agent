"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callDetailed } from "./api";

/** Drafts the interview-style answers that are still empty, from the profile, and saves them in the answer bank (answers already written are never touched). */
export function WriteAnswersButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await callDetailed<{ written: number; note?: string }>("/api/answers/draft", "POST", undefined, 70_000);
      setBusy(false);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.data.note ?? "Done");
      router.refresh();
    }}>{busy ? "Starting..." : "Write the interview answers from my profile"}</Button>
  );
}
