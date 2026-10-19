"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { call } from "./api";

type P = { id: string; name: string; email: string | null; is_default: boolean; enabled: boolean };

function Row({ p, current }: { p: P; current: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(p.name);
  const [email, setEmail] = useState(p.email ?? "");
  const changed = name.trim() !== p.name || email.trim().toLowerCase() !== (p.email ?? "");
  async function save() { if (await call(`/api/profiles/${p.id}`, "PATCH", { name, email }, "Saved")) router.refresh(); }
  async function toggle() { if (await call(`/api/profiles/${p.id}`, "PATCH", { enabled: !p.enabled }, p.enabled ? "Automation switched off for this profile" : "Automation switched on")) router.refresh(); }
  async function open() { if (await call("/api/profiles/switch", "POST", { id: p.id })) router.push("/"); router.refresh(); }
  async function remove() {
    const typed = window.prompt(`This permanently deletes ${p.name}'s profile, jobs, applications, resumes, settings and logs. It cannot be undone.\n\nType the name "${p.name}" to confirm.`);
    if (typed?.trim() === p.name && (await call(`/api/profiles/${p.id}`, "DELETE", undefined, "Deleted"))) router.refresh();
  }
  return (
    <li className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1"><label className="text-xs font-medium" htmlFor={`pn-${p.id}`}>Name</label><Input id={`pn-${p.id}`} className="w-52" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1"><label className="text-xs font-medium" htmlFor={`pe-${p.id}`}>Their email (gets their notifications)</label><Input id={`pe-${p.id}`} type="email" className="w-72" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <Button size="sm" onClick={save} disabled={!changed || !name.trim()}>Save</Button>
        {!current && <Button size="sm" variant="outline" onClick={open}>Work on this profile</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {p.is_default && <span className="rounded border px-2 py-0.5">Main profile</span>}
        {current && <span className="rounded border border-emerald-400 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">Open now</span>}
        <span className="rounded border px-2 py-0.5">{p.enabled ? "Automation on" : "Automation off"}</span>
        <Button size="sm" variant="outline" onClick={toggle}>{p.enabled ? "Switch automation off" : "Switch automation on"}</Button>
        {!p.is_default && <Button size="sm" variant="outline" onClick={remove}>Delete profile</Button>}
      </div>
    </li>
  );
}

/** Create and manage the profiles (yourself, family members, a second profile of your own). */
export function ProfilesCard({ profiles, currentId, ready }: { profiles: P[]; currentId: string | null; ready: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  async function add() {
    if (await call("/api/profiles", "POST", { name, email }, "Profile created")) { setName(""); setEmail(""); router.refresh(); }
  }
  if (!ready) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>One more setup step</CardTitle>
          <CardDescription>
            Several profiles need a one-time database update. Open <b>System health</b>, copy the SQL shown for <b>0003_profiles</b> into Supabase (SQL editor, Run), then come back here.
            Your existing data becomes the main profile; nothing is lost.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>People (profiles)</CardTitle>
        <CardDescription>
          Each profile is a separate person with their own resume data, answers, countries, job sources&apos; settings, schedules, jobs, applications, caps and logs. The agent finds, scores,
          prepares and applies for each one on its own. The AI models and the shared job-source keys are common to all. Notifications for every profile come to you on Telegram and email, and to the
          profile&apos;s own email too.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid gap-3">{profiles.map((p) => <Row key={`${p.id}:${p.name}:${p.email}`} p={p} current={p.id === currentId} />)}</ul>
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <div className="text-sm font-medium">Add a profile</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="np-name">Name</label><Input id="np-name" className="w-52" placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1"><label className="text-xs font-medium" htmlFor="np-email">Their email</label><Input id="np-email" type="email" className="w-72" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <Button onClick={add} disabled={!name.trim()}>Create profile</Button>
          </div>
          <p className="text-xs text-muted-foreground">After creating it, switch to it (header, or &quot;Work on this profile&quot;) and fill in its Profile, Countries and Job sources &rarr; mailbox (the address the agent applies from).</p>
        </div>
      </CardContent>
    </Card>
  );
}
