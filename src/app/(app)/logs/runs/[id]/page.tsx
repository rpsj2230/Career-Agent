import Link from "next/link";
import { notFound } from "next/navigation";
import { LogTable } from "@/components/app/log-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { parseLogFilters } from "@/lib/log-filters";
import { getRun, queryLogs } from "@/lib/log-queries";
import { fmtDateTime, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { run, scans } = await getRun(id);
  if (!run) notFound();
  const { rows } = await queryLogs({ ...parseLogFilters({ run: id }), page: 1 });
  const failed = run.status === "failed" || run.status === "partial";

  return (
    <div className="grid gap-4">
      <div>
        <Link href="/logs/runs" className="text-sm text-muted-foreground hover:underline">All runs</Link>
        <h1 className="text-2xl font-semibold">{run.kind} run <span className="font-mono text-base text-muted-foreground">{run.id.slice(0, 8)}</span></h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge className={run.status === "succeeded" ? "bg-green-600 text-white" : run.status === "failed" ? "bg-destructive text-white" : run.status === "partial" ? "bg-amber-500 text-white" : ""}>{run.status}</Badge>
          <span>Started {fmtDateTime(run.started_at)}</span>
          <span>· {run.finished_at ? `finished ${fmtDateTime(run.finished_at)} (${fmtDuration(run.started_at, run.finished_at)})` : "not finished"}</span>
          <span>· trigger: {run.trigger}</span>
        </div>
      </div>

      {failed && run.error && <Card className="border-destructive"><CardHeader><CardTitle className="text-destructive">{run.status === "failed" ? "Why it failed" : "What went wrong"}</CardTitle></CardHeader><CardContent className="text-sm">{run.error}</CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Counters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(run.stats ?? {}).length === 0 ? <span className="text-sm text-muted-foreground">None recorded.</span> : Object.entries(run.stats).map(([k, v]) => <Badge key={k} variant="secondary">{k}: {v}</Badge>)}
        </CardContent>
      </Card>

      {scans.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Scans in this run</CardTitle><CardDescription>Which sources were queried and what they returned.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead>Query</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.started_at)}</TableCell><TableCell>{portalLabel(s.integration)}</TableCell>
                    <TableCell>{s.country ? countryLabel(s.country) : "-"}</TableCell><TableCell>{s.query ?? "-"}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{s.status === "error" ? <span className="text-destructive">{s.error}</span> : `${s.fetched} fetched, ${s.inserted} new, ${s.duplicates} already known, ${s.stale} too old, ${s.invalid} unusable`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Everything logged during this run</CardTitle></CardHeader>
        <CardContent><LogTable rows={rows} showRun={false} /></CardContent>
      </Card>
    </div>
  );
}
