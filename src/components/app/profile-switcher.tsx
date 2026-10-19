"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Users } from "lucide-react";
import { call } from "./api";

/** Which person's jobs, applications and settings the whole app is showing. Only shown when there is more than one profile to choose from. */
export function ProfileSwitcher({ profiles, currentId }: { profiles: { id: string; name: string }[]; currentId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (profiles.length < 2) return null;
  async function pick(id: string) {
    setBusy(true);
    if (await call("/api/profiles/switch", "POST", { id })) router.refresh();
    setBusy(false);
  }
  return (
    <div className="mb-3 grid gap-1 px-3">
      <label htmlFor="profile-switch" className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Users className="size-3" /> Profile</label>
      <select id="profile-switch" disabled={busy} className="h-9 w-full rounded-md border bg-background px-2 text-sm font-medium" value={currentId ?? ""} onChange={(e) => pick(e.target.value)}>
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}
