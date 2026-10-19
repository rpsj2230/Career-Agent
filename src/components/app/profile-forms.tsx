"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ROLE_PRESETS, rowsToSave, toggleCsv, type AnswerRow } from "@/lib/standard-questions";
import { AutofillButton } from "./autofill-button";
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
      const raw = await res.text();
      let data: { error?: string; model?: string; masterKept?: { name?: string; error?: string } | null; masterGiven?: boolean } = {};
      try { data = JSON.parse(raw); } catch { /* the host answered with a plain page, not JSON */ }
      if (!res.ok) toast.error(data.error ?? (res.status === 413 ? "The files are too large to upload here (the limit is about 4 MB in total). Upload your master resume alone first." : res.status === 504 || res.status === 408 ? "The import took too long and was cut off. Try again, or paste less text." : `Import failed (HTTP ${res.status}): ${raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "no details"}`));
      else {
        toast.success(`Draft ready (model ${data.model}). Review it below before confirming.`);
        // the file shown on the Resumes page changes only when it was uploaded in box 1; say what happened to it
        if (data.masterKept?.name) toast.success(`Master resume file replaced: ${data.masterKept.name}. It now shows on the Resumes page.`);
        else if (data.masterKept?.error) toast.error(`Your profile draft is ready, but the master resume file was NOT replaced: ${data.masterKept.error}. Upload it on the Resumes page instead.`);
        else if (!data.masterGiven) toast.message("The master resume file on the Resumes page was not changed, because no file was chosen in box 1. Upload it on the Resumes page if you want it replaced.");
        router.refresh();
      }
    } catch (err) {
      toast.error(`Import failed: the server could not be reached (${err instanceof Error ? err.message : "network error"}). Check your connection and try again.`);
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <section className="grid gap-2">
        <Label htmlFor="master">1. Your master resume (PDF or DOCX)</Label>
        <Input id="master" name="master" type="file" accept=".pdf,.docx" />
        <p className="text-xs text-muted-foreground">One file, uploaded once. It sets the sections and wording of your profile (Career Highlights, Core Competencies, Technical Skills, Experience and so on), it becomes the master resume template on the Resumes page, and it is kept as the fallback resume when a tailored one cannot be made. If you have two resumes, choose the one you want as the master here.</p>
      </section>

      <section className="grid gap-2">
        <Label htmlFor="files">2. Supporting documents (optional)</Label>
        <Input id="files" name="files" type="file" multiple accept=".pdf,.docx,.txt,.md,.zip,.json" />
        <p className="text-xs text-muted-foreground">Your LinkedIn &quot;Save to PDF&quot; (on your profile: More, then Save to PDF), a second resume, or the LinkedIn data export (.zip). These only add to your profile: skills your master resume does not list are added for job search and scoring (they are not printed in the master template), and anything else they contain is listed for you to review. A ready-made .json profile file is also accepted here and is loaded exactly as written, with no AI model.</p>
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Or paste text from your LinkedIn page instead of a PDF</summary>
        <Textarea id="pasted" name="pasted" rows={6} className="mt-2" placeholder="Paste the copied profile text here" />
      </details>

      <p className="text-xs text-muted-foreground">Your text is sent to the configured AI model provider. Remove ID numbers and dates of birth first. After the import you review the result before anything is used.</p>
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

export function PreferencesForm({ prefs, searching, profileTitles }: { prefs: Prefs; searching: { names: string[]; configured: boolean }; profileTitles: string[] }) {
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
      <div className="grid gap-1"><Label>Target countries</Label>
        <p className="rounded-md border bg-muted/40 p-3 text-sm">{searching.names.length > 0 ? <>Searching: <b>{searching.names.join(", ")}</b>.</> : "None yet."} Managed on the <Link className="underline" href="/countries">Countries page</Link>.</p></div>
      <div className="grid gap-1 md:col-span-2">
        <Label htmlFor="roles">Target roles (the one place to set them; used for every search and for scoring)</Label>
        <Input id="roles" value={p.roles} placeholder="Product Manager, Program Manager" onChange={(e) => set("roles", e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {profileTitles.length > 0 && <span className="self-center text-xs text-muted-foreground">From your profile:</span>}
          {profileTitles.map((r) => (
            <button type="button" key={`p-${r}`} onClick={() => set("roles", toggleCsv(p.roles, r))}>
              <Badge variant={csv(p.roles).map((x) => x.toLowerCase()).includes(r.toLowerCase()) ? "default" : "secondary"}>{r}</Badge>
            </button>
          ))}
          {ROLE_PRESETS.map((r) => (
            <button type="button" key={r} onClick={() => set("roles", toggleCsv(p.roles, r))}>
              <Badge variant={csv(p.roles).map((x) => x.toLowerCase()).includes(r.toLowerCase()) ? "default" : "outline"}>{r}</Badge>
            </button>
          ))}
        </div>
      </div>
      {field("payCountry", "Country your pay figures below are in", "in")}
      <p className="self-end pb-2 text-xs text-muted-foreground">Pay and visa answers are only sent to forms in this country. For any other country, set that country&apos;s expected salary and work authorisation on the Countries page, or answer once when an application is handed back (choose &quot;only for this country&quot;).</p>
      {field("currentCtc", "Current CTC (in that country's terms)", "24 LPA")}
      {field("expectedCtc", "Expected CTC (in that country's terms)", "32 LPA")}
      {field("noticePeriod", "Notice period", "60 days")}
      {field("visaStatus", "Work authorisation / visa (in that country)", "Indian citizen")}
      <div className="flex items-center gap-2"><Checkbox id="relocate" checked={!!p.relocate} onCheckedChange={(v) => set("relocate", v === true)} /><Label htmlFor="relocate">Open to relocation</Label></div>
      <div className="flex flex-wrap gap-2 md:col-span-2"><Button onClick={save}>Save preferences</Button><AutofillButton scope="preferences" label="Fill empty fields from my profile" /></div>
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
