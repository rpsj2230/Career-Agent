"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { call } from "./api";

export function ImportBox() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await fetch("/api/profile/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? "Import failed");
      else { toast.success(`Draft ready (model ${data.model}). Review it below before confirming.`); router.refresh(); }
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="files">Resume (PDF, DOCX, TXT) and/or LinkedIn data export (.zip)</Label>
        <Input id="files" name="files" type="file" multiple required accept=".pdf,.docx,.txt,.md,.zip" />
      </div>
      <p className="text-xs text-muted-foreground">Your text is sent to the configured free model providers. Remove ID numbers and dates of birth first.</p>
      <Button type="submit" disabled={busy} className="w-fit">{busy ? "Reading and structuring..." : "Import"}</Button>
    </form>
  );
}

export function DraftReview({ initial, conflicts }: { initial: unknown; conflicts: string[] }) {
  const router = useRouter();
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [busy, setBusy] = useState(false);
  async function confirm() {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return toast.error("That is not valid JSON"); }
    setBusy(true);
    const ok = await call("/api/profile/confirm", "POST", parsed, "Profile saved as your source of truth");
    setBusy(false);
    if (ok) router.refresh();
  }
  async function discard() { if (await call("/api/profile/import", "DELETE", undefined, "Draft discarded")) router.refresh(); }
  return (
    <div className="grid gap-3">
      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-500 p-3 text-sm">
          <div className="font-medium">Sources disagree; please check:</div>
          <ul className="list-disc pl-5">{conflicts.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <Label htmlFor="draft">Extracted profile (edit anything wrong, keep the ids)</Label>
      <Textarea id="draft" value={text} onChange={(e) => setText(e.target.value)} rows={22} className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button onClick={confirm} disabled={busy}>{busy ? "Saving..." : "Confirm profile"}</Button>
        <Button variant="outline" onClick={discard}>Discard draft</Button>
      </div>
    </div>
  );
}

type Prefs = { countries: string[]; roles: string[]; currentCtc?: string; expectedCtc?: string; noticePeriod?: string; visaStatus?: string; relocate?: boolean };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function PreferencesForm({ prefs }: { prefs: Prefs }) {
  const router = useRouter();
  const [p, setP] = useState({ ...prefs, countries: prefs.countries.join(", "), roles: prefs.roles.join(", ") });
  const set = (k: string, v: unknown) => setP((o) => ({ ...o, [k]: v }));
  async function save() {
    const body = { ...p, countries: csv(p.countries).map((c) => c.toLowerCase()), roles: csv(p.roles) };
    if (await call("/api/profile/preferences", "PUT", body, "Preferences saved")) router.refresh();
  }
  const field = (id: keyof typeof p, label: string, ph = "") => (
    <div className="grid gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} value={(p[id] as string) ?? ""} placeholder={ph} onChange={(e) => set(id, e.target.value)} /></div>
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {field("countries", "Target countries (ISO codes)", "in, sg, ae")}
      {field("roles", "Target roles", "Product Manager, Program Manager")}
      {field("currentCtc", "Current CTC", "24 LPA")}
      {field("expectedCtc", "Expected CTC", "32 LPA")}
      {field("noticePeriod", "Notice period", "60 days")}
      {field("visaStatus", "Work authorisation / visa", "Indian citizen")}
      <div className="flex items-center gap-2"><Checkbox id="relocate" checked={!!p.relocate} onCheckedChange={(v) => set("relocate", v === true)} /><Label htmlFor="relocate">Open to relocation</Label></div>
      <div className="md:col-span-2"><Button onClick={save}>Save preferences</Button></div>
    </div>
  );
}

export function AnswerBankEditor({ initial }: { initial: { question: string; answer: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.length ? initial : [{ question: "", answer: "" }]);
  const update = (i: number, k: "question" | "answer", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function save() {
    const items = rows.filter((r) => r.question.trim());
    if (await call("/api/answers", "PUT", { items }, "Answer bank saved")) router.refresh();
  }
  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="Question, e.g. Are you legally authorised to work in Singapore?" value={r.question} onChange={(e) => update(i, "question", e.target.value)} />
          <Input placeholder="Your answer" value={r.answer} onChange={(e) => update(i, "answer", e.target.value)} />
          <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setRows((r) => [...r, { question: "", answer: "" }])}>Add answer</Button>
        <Button onClick={save}>Save answer bank</Button>
      </div>
    </div>
  );
}
