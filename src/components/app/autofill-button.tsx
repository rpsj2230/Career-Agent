"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { call } from "./api";

/** Fill only the EMPTY fields from the profile; anything already set is kept. Safe to press at any time. */
export function AutofillButton({ scope, country, label }: { scope: "country" | "countries" | "preferences"; country?: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await call<{ note?: string }>("/api/autofill", "POST", { scope, country }, "Done");
      setBusy(false);
      if (r) router.refresh();
    }}>{busy ? "Filling..." : label}</Button>
  );
}
