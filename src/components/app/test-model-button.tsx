"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; text: string } | null;

/** Tests one model and keeps the answer on screen: "Passed" or "Failed" with the reason, next to the button. */
export function TestModelButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  async function run() {
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/models/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
      const data = await res.json().catch(() => ({}));
      setResult(res.ok ? { ok: true, text: String(data.note ?? "Works") } : { ok: false, text: String(data.error ?? `Request failed (${res.status})`) });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Network error" });
    }
    setBusy(false);
    router.refresh(); // the Status column now includes this test
  }
  return (
    <div className="grid gap-1">
      <Button size="sm" variant="secondary" onClick={run} disabled={disabled || busy}>{busy ? <><Loader2 className="size-3 animate-spin" /> Testing</> : "Test"}</Button>
      {result && (
        <div className="max-w-56 whitespace-normal text-xs">
          <Badge className={result.ok ? "bg-green-600 text-white" : "bg-amber-500 text-white"}>{result.ok ? "Passed" : "Failed"}</Badge>
          <div className="mt-1 break-words text-muted-foreground">{result.text.slice(0, 200)}</div>
        </div>
      )}
    </div>
  );
}
