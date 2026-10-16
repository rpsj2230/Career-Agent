import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import type { LogRow } from "@/lib/log-queries";
import { fmtDateTime } from "@/lib/time";

const LEVEL_STYLE = { info: "bg-muted text-muted-foreground", warn: "bg-amber-500 text-white", error: "bg-destructive text-white" } as const;

export function LogTable({ rows, showRun = true }: { rows: LogRow[]; showRun?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No activity matches these filters.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>When</TableHead><TableHead>Level</TableHead><TableHead>Event</TableHead><TableHead>What happened</TableHead><TableHead>Portal</TableHead><TableHead>Country</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead><TableHead>Open</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</TableCell>
            <TableCell><Badge className={LEVEL_STYLE[r.level] ?? LEVEL_STYLE.info}>{r.level}</Badge></TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs">{r.kind}</TableCell>
            <TableCell className="max-w-md whitespace-normal text-sm">
              {r.message}
              {Object.keys(r.detail ?? {}).length > 0 && (
                <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">Details</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(r.detail, null, 2)}</pre></details>
              )}
            </TableCell>
            <TableCell>{r.portal ? <Link href={`/logs?portal=${r.portal}`}><Badge variant="outline">{portalLabel(r.portal)}</Badge></Link> : "-"}</TableCell>
            <TableCell className="text-sm">{r.country ? countryLabel(r.country) : "-"}</TableCell>
            <TableCell className="max-w-40 whitespace-normal text-sm">{r.company ?? "-"}</TableCell>
            <TableCell className="text-xs">{r.status ?? "-"}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              {r.job_id && <Link className="underline" href={`/jobs/${r.job_id}`}>job</Link>}{r.job_id && r.application_id && " · "}
              {r.application_id && <Link className="underline" href={`/applications/${r.application_id}`}>application</Link>}
              {showRun && r.run_id && <>{(r.job_id || r.application_id) && " · "}<Link className="underline" href={`/logs/runs/${r.run_id}`}>run</Link></>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
