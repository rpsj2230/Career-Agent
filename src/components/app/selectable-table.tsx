"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type BulkAction = { label: string; action: "prepare" | "approve" | "skip" | "regenerate" | "reapply"; confirm?: string; variant?: "default" | "outline" | "destructive" };
/** How many rows go in one request: approving can send an email each, so it takes smaller batches than the quick actions. */
const CHUNK: Record<BulkAction["action"], number> = { approve: 8, skip: 25, reapply: 40, regenerate: 10, prepare: 25 };
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
    const ids = [...sel];
    if (a.confirm && !window.confirm(a.confirm.replace("{n}", String(ids.length)))) return;
    setBusy(a.action);
    // a big selection is sent in small batches, one after the other, so no single request runs into the web server's time limit
    const size = CHUNK[a.action];
    const total = { count: 0, automated: 0, emailed: 0 };
    const problems = new Map<string, number>();
    const extras = new Set<string>();
    const errors: string[] = [];
    let queue = ids, handled = 0, failedInARow = 0;
    const toastId = toast.loading(`${a.label}: 0 of ${ids.length}`);
    try {
      while (queue.length > 0 && failedInARow < 2) {
        const chunk = queue.slice(0, size);
        queue = queue.slice(size);
        let data: { error?: string; count?: number; automated?: number; emailed?: number; extra?: string; problems?: { error: string }[]; unreached?: string[] } = {};
        let ok = false;
        try {
          const res = await fetch("/api/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a.action, ids: chunk }) });
          data = await res.json().catch(() => ({}));
          ok = res.ok;
          if (!ok) errors.push(data.error ?? `Request failed (${res.status})`);
        } catch (e) { errors.push(e instanceof Error ? e.message : "The request did not reach the server"); }
        failedInARow = ok ? 0 : failedInARow + 1;
        if (!ok) continue;
        total.count += data.count ?? 0; total.automated += data.automated ?? 0; total.emailed += data.emailed ?? 0;
        for (const p of data.problems ?? []) problems.set(p.error.slice(0, 140), (problems.get(p.error.slice(0, 140)) ?? 0) + 1);
        if (data.extra) extras.add(data.extra);
        const unreached = data.unreached ?? [];
        handled += chunk.length - unreached.length;
        if (unreached.length > 0 && unreached.length < chunk.length) queue = [...unreached, ...queue];
        else if (unreached.length === chunk.length) errors.push("the server was too slow for this batch");
        toast.loading(`${a.label}: ${Math.min(handled, ids.length)} of ${ids.length}`, { id: toastId });
      }
    } finally { setBusy(null); }
    const parts = [a.action === "approve" ? `Approved ${total.count} of ${ids.length}.` : `${a.label}: ${total.count} of ${ids.length}.`];
    if (a.action === "approve") {
      if (total.automated) parts.push(`${total.automated} will be sent automatically from the cloud.`);
      if (total.count - total.automated > 0) parts.push(`${total.count - total.automated} wait for the assistant on your computer, or for you to submit.`);
      if (total.emailed) parts.push(`${total.emailed} also emailed to the employer.`);
    }
    for (const [reason, n] of problems) parts.push(`${n} not approved: ${reason}.`);
    parts.push(...extras);
    if (errors.length) parts.push(`Some requests failed (${[...new Set(errors)].join("; ").slice(0, 200)}). Reload the page to see what was done, then press the button again for the rest.`);
    if (queue.length > 0) parts.push(`${queue.length} were not tried.`);
    toast.dismiss(toastId);
    if (errors.length && total.count === 0) toast.error(parts.join(" "), { duration: 15000 }); else toast.success(parts.join(" "), { duration: 15000 });
    setSel(new Set());
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(selectable))} disabled={selectable.length === 0} aria-label="Select all on this page" />Select all on this page ({selectable.length})</label>
        <span className="text-muted-foreground">{sel.size} selected</span>
        {actions.map((a) => <Button key={a.action} size="sm" variant={a.variant ?? "default"} disabled={sel.size === 0 || busy !== null} onClick={() => run(a)}>{busy === a.action ? "Working..." : `${a.label}${sel.size ? ` (${sel.size})` : ""}`}</Button>)}
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
