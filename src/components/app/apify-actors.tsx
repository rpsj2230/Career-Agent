"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ApifyActor } from "@/lib/jobs/apify";
import { call } from "./api";

type Row = { id: string; portal: string; max_items: number; enabled: boolean; input: string };
const toRow = (a: ApifyActor): Row => ({ id: a.id, portal: a.portal, max_items: a.max_items, enabled: a.enabled, input: JSON.stringify(a.input, null, 2) });
const BLANK: Row = { id: "", portal: "linkedin", max_items: 50, enabled: true, input: '{\n  "keywords": "{{title}}",\n  "location": "{{location}}"\n}' };

/** The scrapers that run on every scan. The input is copied from the scraper's own documentation, with placeholders where it expects the search. */
export function ApifyActors({ actors }: { actors: ApifyActor[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(actors.map(toRow));
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));

  async function save() {
    const out: ApifyActor[] = [];
    for (const [i, r] of rows.entries()) {
      let input: Record<string, unknown>;
      try { input = JSON.parse(r.input || "{}"); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("not an object"); }
      catch { alert(`Scraper ${i + 1}: the input is not valid JSON (it must be an object).`); return; }
      out.push({ id: r.id.trim(), portal: r.portal.trim(), max_items: Number(r.max_items) || 50, enabled: r.enabled, input });
    }
    if (await call("/api/settings", "PUT", { key: "apify", value: { actors: out } }, "Scrapers saved")) router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="text-sm font-medium">Scrapers</div>
      <p className="text-xs text-muted-foreground">One row per scraper from the Apify Store. Copy its input example from its page and put <code>{"{{title}}"}</code>, <code>{"{{location}}"}</code>, <code>{"{{country}}"}</code>, <code>{"{{days}}"}</code> or <code>{"{{max_items}}"}</code> where it expects them. It runs once per title and location on your Countries page.</p>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md bg-muted/40 p-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="grid gap-1"><Label htmlFor={`aid-${i}`}>Actor id</Label><Input id={`aid-${i}`} value={r.id} placeholder="username~actor-name" onChange={(e) => set(i, { id: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor={`ap-${i}`}>Portal it reads</Label><Input id={`ap-${i}`} value={r.portal} placeholder="linkedin" onChange={(e) => set(i, { portal: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor={`am-${i}`}>Jobs per search</Label><Input id={`am-${i}`} type="number" min={1} max={500} value={r.max_items} onChange={(e) => set(i, { max_items: Number(e.target.value) })} /></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><Switch checked={r.enabled} onCheckedChange={(v) => set(i, { enabled: v })} /> On</label>
          <div className="grid gap-1 md:col-span-4"><Label htmlFor={`ai-${i}`}>Input (JSON)</Label><Textarea id={`ai-${i}`} rows={5} className="font-mono text-xs" value={r.input} onChange={(e) => set(i, { input: e.target.value })} /></div>
          <div className="md:col-span-4"><Button variant="outline" size="sm" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remove</Button></div>
        </div>
      ))}
      <div className="flex gap-2"><Button variant="outline" onClick={() => setRows([...rows, { ...BLANK }])}>Add a scraper</Button><Button onClick={save}>Save scrapers</Button></div>
    </div>
  );
}
