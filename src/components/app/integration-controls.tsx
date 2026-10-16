"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CredentialDef } from "@/lib/integrations/catalog";
import { ActionButton } from "./action-button";
import { call } from "./api";

export function EnabledSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  async function toggle(v: boolean) {
    setOn(v);
    const ok = await call(`/api/integrations/${id}`, "PUT", { enabled: v }, v ? "Enabled" : "Disabled");
    if (!ok) setOn(!v); else router.refresh();
  }
  return <label className="flex items-center gap-2 text-sm"><Switch checked={on} onCheckedChange={toggle} /> {on ? "Enabled" : "Disabled"}</label>;
}

export function CredentialsDialog({ id, name, credentials, saved }: { id: string; name: string; credentials: CredentialDef[]; saved: Record<string, "app" | "env" | null> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const any = Object.values(saved).some(Boolean);

  async function save() {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (Object.keys(filled).length === 0) return;
    if (await call(`/api/integrations/${id}/credentials`, "PUT", { values: filled }, "Saved (encrypted). Press Test.")) { setValues({}); setOpen(false); router.refresh(); }
  }
  async function remove() {
    if (window.confirm(`Remove the saved ${name} credentials?`) && (await call(`/api/integrations/${id}/credentials`, "DELETE", undefined, "Removed"))) { setOpen(false); router.refresh(); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={any ? "outline" : "default"}>{any ? "Edit connection" : "Connect"}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {name}</DialogTitle>
          <DialogDescription>Stored encrypted in your database and never shown again. Paste a new value to replace one.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {credentials.map((c) => (
            <div key={c.key} className="grid gap-1">
              <Label htmlFor={`${id}-${c.key}`}>{c.label} {saved[c.key] && <span className="text-xs text-muted-foreground">({saved[c.key] === "app" ? "saved in the app" : "from server settings"})</span>}</Label>
              <Input id={`${id}-${c.key}`} type="password" autoComplete="off" placeholder={saved[c.key] ? "••••••••••••" : c.help} value={values[c.key] ?? ""} onChange={(e) => setValues({ ...values, [c.key]: e.target.value })} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button onClick={save}>Save</Button>
            {Object.values(saved).includes("app") && <Button variant="outline" onClick={remove}>Remove saved</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationActions({ id, discovers }: { id: string; discovers: boolean }) {
  return (
    <>
      <ActionButton size="sm" variant="secondary" endpoint={`/api/integrations/${id}/test`}>Test</ActionButton>
      {discovers && <ActionButton size="sm" variant="secondary" endpoint={`/api/integrations/${id}/scan`}>Scan now</ActionButton>}
    </>
  );
}
