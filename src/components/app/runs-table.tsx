import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunRow } from "@/lib/log-queries";
import { runCounts } from "@/lib/run-view";
import { fmtDateTime, fmtDuration } from "@/lib/time";

export const STATUS_STYLE: Record<string, string> = { succeeded: "bg-green-600 text-white", partial: "bg-amber-500 text-white", failed: "bg-destructive text-white", running: "bg-blue-600 text-white", cancelled: "bg-muted text-muted-foreground" };

/** What a run was: the schedule's name, or the hourly round that works through the backlog between schedules. */
export function runName(r: Pick<RunRow, "scope" | "kind" | "trigger">): string {
  const s = r.scope as { schedule?: unknown } | null;
  const name = typeof s?.schedule === "string" ? s.schedule : "";
  if (name && !/^backlog/i.test(name)) return name;
  return r.kind === "pipeline" ? "Hourly backlog round" : r.kind;
}

const TRIGGER: Record<string, string> = { schedule: "by schedule", manual: "you pressed Run", api: "by the app", worker: "by a worker" };

/** One row per run, the same six columns everywhere, each row opening the full detail of that run. */
export function RunsTable({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet. The first one starts at the next hourly check, or press Run this schedule now.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead><TableHead>What</TableHead><TableHead>Outcome</TableHead><TableHead>Took</TableHead>
          <TableHead className="text-right">Found</TableHead><TableHead className="text-right">Scored</TableHead><TableHead className="text-right">Matched</TableHead>
          <TableHead className="text-right">Prepared</TableHead><TableHead className="text-right">Approved</TableHead><TableHead>Problems</TableHead><TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => {
          const c = runCounts(r.stats);
          return (
            <TableRow key={r.id} className="align-top">
              <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.started_at)}</TableCell>
              <TableCell className="whitespace-normal text-sm"><div className="font-medium">{runName(r)}</div><div className="text-xs text-muted-foreground">{TRIGGER[r.trigger] ?? r.trigger}</div></TableCell>
              <TableCell><Badge className={STATUS_STYLE[r.status] ?? ""}>{r.status}</Badge></TableCell>
              <TableCell className="whitespace-nowrap text-xs">{fmtDuration(r.started_at, r.finished_at) ?? (r.status === "running" ? "running" : "-")}</TableCell>
              <TableCell className="text-right tabular-nums">{c.found}</TableCell><TableCell className="text-right tabular-nums">{c.scored}</TableCell><TableCell className="text-right tabular-nums">{c.matched}</TableCell>
              <TableCell className="text-right tabular-nums">{c.prepared}</TableCell><TableCell className="text-right tabular-nums">{c.approved}</TableCell>
              <TableCell className="max-w-xs whitespace-normal text-xs text-destructive">{r.error ? <span className="line-clamp-2">{r.error}</span> : c.problems ? `${c.problems} problem${c.problems === 1 ? "" : "s"}` : <span className="text-muted-foreground">none</span>}</TableCell>
              <TableCell><Link className="text-sm underline" href={`/logs/runs/${r.id}`}>Details</Link></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
