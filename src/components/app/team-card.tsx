"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ROLE_LABEL, type TeamMember, type TeamRole } from "@/lib/roles";
import { call } from "./api";

/** Give other people limited access. They sign in with Google using this email. */
export function TeamCard({ owner, members, profiles = [] }: { owner: string | null; members: TeamMember[]; profiles?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("jobs");
  const [picked, setPicked] = useState<string[]>([]);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? "a deleted profile";
  async function add() {
    if (await call("/api/team", "PUT", { email: email.trim(), role, profiles: picked }, "Saved")) { setEmail(""); setPicked([]); router.refresh(); }
  }
  async function remove(e: string) {
    if (window.confirm(`Remove ${e}?`) && (await call(`/api/team?email=${encodeURIComponent(e)}`, "DELETE", undefined, "Removed"))) router.refresh();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team access</CardTitle>
        <CardDescription>
          You are the super admin{owner ? ` (${owner})` : ""}: you see everything. Add people who should only see <b>Jobs found &amp; scored</b> and <b>Applications</b>.
          They sign in with Google using the email you add here. <b>Jobs &amp; Apply</b> can also prepare, approve and send applications; <b>View only</b> can look but not change anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {members.length === 0 ? <p className="text-sm text-muted-foreground">Nobody else has access yet.</p> : (
          <ul className="grid gap-2">
            {members.map((m) => (
              <li key={m.email} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{m.email}</span>
                <span className="rounded border px-2 py-0.5 text-xs">{ROLE_LABEL[m.role]}</span>
                {profiles.length > 1 && <span className="text-xs text-muted-foreground">{m.profiles?.length ? `Profiles: ${m.profiles.map(nameOf).join(", ")}` : "Main profile only"}</span>}
                <Button size="sm" variant="outline" onClick={() => remove(m.email)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><label className="text-sm font-medium" htmlFor="tm-email">Google email</label><Input id="tm-email" type="email" className="w-72" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="tm-role">Access</label>
            <select id="tm-role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <option value="jobs">{ROLE_LABEL.jobs}</option>
              <option value="viewer">{ROLE_LABEL.viewer}</option>
            </select>
          </div>
          {profiles.length > 1 && (
            <fieldset className="grid gap-1">
              <legend className="text-sm font-medium">Which profiles they can open</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {profiles.map((p) => (
                  <label key={p.id} className="flex items-center gap-1"><input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />{p.name}</label>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">None ticked = the main profile only. A family member gets only their own.</span>
            </fieldset>
          )}
          <Button onClick={add} disabled={!email.trim()}>Add / change</Button>
        </div>
      </CardContent>
    </Card>
  );
}
