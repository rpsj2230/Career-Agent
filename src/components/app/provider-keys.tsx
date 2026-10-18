"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "./api";

export type KeySlot = { env: string; set: boolean };

/** "GEMINI_API_KEY" is key 1, "GEMINI_API_KEY_2" is key 2, and so on. */
export const slotNumber = (env: string): number => Number(/_(\d+)$/.exec(env)?.[1] ?? 1);

/** One box per key of a provider. Saving a key makes it available to every model row that uses the same key name. */
export function ProviderKeys({ provider, slots }: { provider: string; slots: KeySlot[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function save(s: KeySlot) {
    const apiKey = (values[s.env] ?? "").trim();
    if (!apiKey) return;
    setBusy(s.env);
    const ok = await call("/api/models/key", "PUT", { env: s.env, apiKey }, `${provider} key ${slotNumber(s.env)} saved (encrypted)`);
    setBusy(null);
    if (ok) { setValues((v) => ({ ...v, [s.env]: "" })); router.refresh(); }
  }
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="text-sm font-medium">{provider} keys</div>
      <div className="text-xs text-muted-foreground">Paste each key into its own box and press Save. Every {provider} model uses all the keys you set here, and the work is spread across them. Use keys from your own accounts only.</div>
      {slots.map((s) => (
        <div key={s.env} className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-sm">Key {slotNumber(s.env)}</span>
          {s.set ? <Badge>set</Badge> : <Badge variant="outline">not set</Badge>}
          <Input className="max-w-sm" type="password" autoComplete="off" placeholder={s.set ? "Paste a new key to replace it" : "Paste the key here"} value={values[s.env] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [s.env]: e.target.value }))} />
          <Button size="sm" disabled={busy === s.env || !(values[s.env] ?? "").trim()} onClick={() => save(s)}>{s.set ? "Replace" : "Save"}</Button>
          <span className="text-xs text-muted-foreground">{s.env}</span>
        </div>
      ))}
    </div>
  );
}
