"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type BulkAction = { label: string; action: "prepare" | "approve" | "skip"; confirm?: string; variant?: "default" | "outline" | "destructive" };
export type SelectableRow = { id: string; /** which bulk id this row contributes (a job id or an application id); null = not selectable */ selectId: string | null; cells: ReactNode[] };

/** A table with checkboxes: tick rows (or all), then do one thing to all of them. The actions go to /api/bulk. */
export function SelectableTable({ head, rows, actions, hint }: { head: ReactNode[]; rows: SelectableRow[]; actions: BulkAction[]; hint?: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const selectable = rows.filter((r) => r.selectId).map((r) => r.selectId as string);
  const allOn = selectable.length > 0 && selectable.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function run(a: BulkAction) {
    const ids = [...sel].slice(0, 50);
    if (a.confirm && !window.confirm(a.confirm.replace("{n}", String(ids.length)))) return;
    setBusy(a.action);
    try {
      const res = await fetch("/api/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a.action, ids }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? `Request failed (${res.status})`);
      else { toast.success(data.note ?? "Done", { duration: 9000 }); setSel(new Set()); router.refresh(); }
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(selectable))} disabled={selectable.length === 0} aria-label="Select all on this page" />Select all on this page ({selectable.length})</label>
        <span className="text-muted-foreground">{sel.size} selected{sel.size > 50 ? " (the first 50 are used)" : ""}</span>
        {actions.map((a) => <Button key={a.action} size="sm" variant={a.variant ?? "default"} disabled={sel.size === 0 || busy !== null} onClick={() => run(a)}>{busy === a.action ? "Working..." : `${a.label}${sel.size ? ` (${Math.min(sel.size, 50)})` : ""}`}</Button>)}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className="w-8" />{head.map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={r.selectId && sel.has(r.selectId) ? "selected" : undefined}>
              <TableCell>{r.selectId ? <input type="checkbox" checked={sel.has(r.selectId)} onChange={() => toggle(r.selectId as string)} aria-label="Select this row" /> : null}</TableCell>
              {r.cells.map((c, i) => <TableCell key={i} className="whitespace-normal">{c}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
