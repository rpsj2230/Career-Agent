"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rowsToSave, type AnswerRow } from "@/lib/standard-questions";
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
    <form onSubmit={submit} className="grid gap-5">
      <section className="grid gap-2">
        <Label htmlFor="linkedinUrl">1. Your LinkedIn profile link (optional)</Label>
        <Input id="linkedinUrl" name="linkedinUrl" placeholder="https://www.linkedin.com/in/your-name" />
        <p className="text-xs text-muted-foreground">Saved on your profile and used in applications that ask for it.</p>
      </section>

      <section className="grid gap-2">
        <Label htmlFor="pasted">2. Paste your LinkedIn profile (recommended)</Label>
        <ol className="list-decimal pl-5 text-xs text-muted-foreground">
          <li>Open your own profile on linkedin.com in your browser, signed in.</li>
          <li>Click &quot;Show all&quot; on Experience, Education and Skills so the full lists are on the page.</li>
          <li>Press Ctrl+A (Cmd+A on Mac) to select everything, then Ctrl+C to copy, and paste it below.</li>
        </ol>
        <Textarea id="pasted" name="pasted" rows={8} placeholder="Paste the copied profile text here" />
        <p className="text-xs text-muted-foreground">Page menus and &quot;people also viewed&quot; are removed automatically. LinkedIn does not allow apps to fetch profiles by link, so copying your own page is the reliable route.</p>
      </section>

      <section className="grid gap-2">
        <Label htmlFor="files">3. Or upload files: resume (PDF, DOCX), LinkedIn &quot;Save to PDF&quot;, or the LinkedIn data export (.zip)</Label>
        <Input id="files" name="files" type="file" multiple accept=".pdf,.docx,.txt,.md,.zip" />
        <p className="text-xs text-muted-foreground">On your profile: More, then Save to PDF. For the full export: LinkedIn Settings, Data privacy, Get a copy of your data. You can combine sources; conflicts are listed for you to resolve.</p>
      </section>

      <p className="text-xs text-muted-foreground">Your text is sent to the configured AI model provider. Remove ID numbers and dates of birth first.</p>
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

type Prefs = { countries: string[]; roles: string[]; payCountry?: string; currentCtc?: string; expectedCtc?: string; noticePeriod?: string; visaStatus?: string; relocate?: boolean };
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
      {field("payCountry", "Country your pay figures below are in", "in")}
      <p className="self-end pb-2 text-xs text-muted-foreground">Pay and visa answers are only sent to forms in this country. For any other country, set that country&apos;s expected salary and work authorisation on the Countries page, or answer once when an application is handed back (choose &quot;only for this country&quot;).</p>
      {field("currentCtc", "Current CTC (in that country's terms)", "24 LPA")}
      {field("expectedCtc", "Expected CTC (in that country's terms)", "32 LPA")}
      {field("noticePeriod", "Notice period", "60 days")}
      {field("visaStatus", "Work authorisation / visa (in that country)", "Indian citizen")}
      <div className="flex items-center gap-2"><Checkbox id="relocate" checked={!!p.relocate} onCheckedChange={(v) => set("relocate", v === true)} /><Label htmlFor="relocate">Open to relocation</Label></div>
      <div className="md:col-span-2"><Button onClick={save}>Save preferences</Button></div>
    </div>
  );
}

export function AnswerBankEditor({ initial }: { initial: AnswerRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<AnswerRow[]>(initial);
  const update = (i: number, answer: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, answer } : x)));
  const updateQ = (i: number, question: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, question } : x)));
  async function save() {
    if (await call("/api/answers", "PUT", { items: rowsToSave(rows) }, "Answer bank saved")) router.refresh();
  }
  const groups = [...new Set(rows.filter((r) => r.standard).map((r) => r.group ?? "Other"))];
  const answered = rows.filter((r) => r.answer.trim()).length;
  const rowView = (r: AnswerRow, i: number) => (
    <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
      {r.standard ? <Label className="self-center text-sm font-normal">{r.question}</Label> : <Input placeholder="Your own question" value={r.question} onChange={(e) => updateQ(i, e.target.value)} />}
      <Input placeholder={r.hint ?? "Your answer"} value={r.answer} onChange={(e) => update(i, e.target.value)} />
      {!r.standard ? <Button variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button> : <span />}
    </div>
  );
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{answered} of {rows.length} answered. Fill what you are comfortable sharing; the agent only uses answers that exist here, and hands the application back to you for anything it cannot answer.</p>
      {groups.map((g) => (
        <section key={g} className="grid gap-2">
          <h3 className="text-sm font-semibold">{g}</h3>
          {rows.map((r, i) => (r.standard && (r.group ?? "Other") === g ? rowView(r, i) : null))}
        </section>
      ))}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Your own questions</h3>
        {rows.map((r, i) => (!r.standard ? rowView(r, i) : null))}
        <Button variant="outline" className="w-fit" onClick={() => setRows((r) => [...r, { question: "", answer: "" }])}>Add your own question</Button>
      </section>
      <Button onClick={save} className="w-fit">Save answer bank</Button>
    </div>
  );
}
