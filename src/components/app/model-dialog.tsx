"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { call } from "./api";

export type ModelForm = {
  label: string; provider: string; base_url: string; model: string; api_key_env: string | null; tasks: string[];
  priority: number; daily_cap: number | null; enabled: boolean; notes?: string | null;
};
const BLANK: ModelForm = { label: "", provider: "", base_url: "https://", model: "", api_key_env: "", tasks: ["score", "tailor", "extract"], priority: 100, daily_cap: null, enabled: true, notes: "" };
const TASKS = ["score", "tailor", "extract"];

export function ModelDialog({ initial, id }: { initial?: ModelForm; id?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState<ModelForm>(initial ?? BLANK);
  const set = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => setM((o) => ({ ...o, [k]: v }));

  async function save() {
    const body = { ...m, api_key_env: m.api_key_env?.trim() || null, notes: m.notes || null };
    if (await call("/api/models", "PUT", body, "Model saved")) { setOpen(false); router.refresh(); }
  }
  async function remove() {
    if (!id || !window.confirm(`Delete ${m.label}?`)) return;
    if (await call(`/api/models?id=${id}`, "DELETE", undefined, "Model deleted")) { setOpen(false); router.refresh(); }
  }
  const text = (k: "label" | "provider" | "base_url" | "model", label: string, disabled = false) => (
    <div className="grid gap-1"><Label htmlFor={k}>{label}</Label><Input id={k} disabled={disabled} value={m[k]} onChange={(e) => set(k, e.target.value)} /></div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={initial ? "outline" : "default"} size={initial ? "sm" : "default"}>{initial ? "Edit" : "Add model"}</Button></DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.label}` : "Add a model"}</DialogTitle>
          <DialogDescription>Any OpenAI-compatible endpoint. The key itself lives in a server environment variable; here you only name it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">{text("label", "Label", !!initial)}{text("provider", "Provider")}</div>
          {text("base_url", "Base URL")}
          {text("model", "Model id")}
          <div className="grid gap-1"><Label htmlFor="env">API key env var name</Label><Input id="env" placeholder="GROQ_API_KEY (blank for local models)" value={m.api_key_env ?? ""} onChange={(e) => set("api_key_env", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><Label htmlFor="prio">Priority (lower runs first)</Label><Input id="prio" type="number" value={m.priority} onChange={(e) => set("priority", Number(e.target.value))} /></div>
            <div className="grid gap-1"><Label htmlFor="cap">Daily call cap (blank = none)</Label><Input id="cap" type="number" value={m.daily_cap ?? ""} onChange={(e) => set("daily_cap", e.target.value === "" ? null : Number(e.target.value))} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {TASKS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={m.tasks.includes(t)} onChange={(e) => set("tasks", e.target.checked ? [...m.tasks, t] : m.tasks.filter((x) => x !== t))} /> {t}
              </label>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm"><Switch checked={m.enabled} onCheckedChange={(v) => set("enabled", v)} /> Enabled</label>
          </div>
          <div className="flex gap-2"><Button onClick={save}>Save</Button>{id && <Button variant="destructive" onClick={remove}>Delete</Button>}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
