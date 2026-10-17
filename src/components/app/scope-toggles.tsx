"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { SCOPE_LABELS, type TailoringScope } from "@/lib/tailor/scope";
import { call } from "./api";

/** What the agent may change for each job. Switched off = that part is always copied from your master resume. */
export function ScopeToggles({ scope }: { scope: TailoringScope }) {
  const router = useRouter();
  const [s, setS] = useState(scope);
  async function flip(k: keyof TailoringScope, v: boolean) {
    const next = { ...s, [k]: v };
    setS(next);
    if (!(await call("/api/settings", "PUT", { key: "tailoring_scope", value: next }, "Saved"))) setS(s);
    else router.refresh();
  }
  return (
    <div className="grid gap-2">
      {(Object.keys(SCOPE_LABELS) as (keyof TailoringScope)[]).map((k) => (
        <label key={k} className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <Switch checked={s[k]} onCheckedChange={(v) => flip(k, v)} className="mt-0.5" />
          <span><b>{SCOPE_LABELS[k].label}</b> <span className="text-muted-foreground">{s[k] ? "changes for each job" : "always as in your master resume"}</span><br /><span className="text-xs text-muted-foreground">{SCOPE_LABELS[k].help}</span></span>
        </label>
      ))}
    </div>
  );
}
