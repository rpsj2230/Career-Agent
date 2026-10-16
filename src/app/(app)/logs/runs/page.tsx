import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { listRuns, recentScans } from "@/lib/log-queries";
import { summarizeScans } from "@/lib/scan-summary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appTimezone, fmtDateTime, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = { succeeded: "bg-green-600 text-white", partial: "bg-amber-500 text-white", failed: "bg-destructive text-white", running: "bg-blue-600 text-white", cancelled: "bg-muted text-muted-foreground" };
const sel = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tz = appTimezone();
  const status = ["running", "succeeded", "partial", "failed", "cancelled"].includes(one(sp.status) ?? "") ? one(sp.status) : undefined;
  const kind = ["pipeline", "scan", "score", "prepare", "apply", "report"].includes(one(sp.kind) ?? "") ? one(sp.kind) : undefined;
  const from = date(one(sp.from)), to = date(one(sp.to));
  const [{ rows, missing }, scans] = await Promise.all([listRuns({ status, kind, from, to, tz }), recentScans({ from, to, tz })]);
  const totals = summarizeScans(scans);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">Runs and scans</h1><p className="text-sm text-muted-foreground">Every automation run with its outcome, and which portals were scanned and what they returned. Times are in {tz}.</p></div>
        <Button variant="outline" asChild><Link href="/logs">Activity log</Link></Button>
      </div>
      {missing && <Alert variant="destructive"><AlertTitle>Database update needed</AlertTitle><AlertDescription>Runs and scans cannot be read until the update is applied. <Link className="underline" href="/system">Open System</Link>.</AlertDescription></Alert>}

      <form method="get" action="/logs/runs" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">From<Input type="date" name="from" defaultValue={from ?? ""} className="h-9" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">To<Input type="date" name="to" defaultValue={to ?? ""} className="h-9" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Outcome<select name="status" defaultValue={status ?? ""} className={sel}><option value="">Any</option>{["running", "succeeded", "partial", "failed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Kind<select name="kind" defaultValue={kind ?? ""} className={sel}><option value="">Any</option>{["pipeline", "scan", "score", "prepare", "apply", "report"].map((s) => <option key={s}>{s}</option>)}</select></label>
        <Button type="submit" size="sm">Apply filters</Button><Button asChild size="sm" variant="ghost"><Link href="/logs/runs">Clear</Link></Button>
      </form>

      <Card>
        <CardHeader><CardTitle>Jobs found per source</CardTitle><CardDescription>From the scans in the selected period. &quot;New&quot; excludes jobs already known.</CardDescription></CardHeader>
        <CardContent>
          {totals.length === 0 ? <p className="text-sm text-muted-foreground">No scans in this period.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Scans</TableHead><TableHead>Failed</TableHead><TableHead>Fetched</TableHead><TableHead>New</TableHead><TableHead>Already known</TableHead><TableHead>Last scan</TableHead></TableRow></TableHeader>
              <TableBody>
                {totals.map((t) => (
                  <TableRow key={t.integration}>
                    <TableCell className="font-medium">{portalLabel(t.integration)}</TableCell><TableCell>{t.scans}</TableCell>
                    <TableCell className={t.failed ? "text-destructive" : ""}>{t.failed}{t.lastError && <div className="max-w-xs whitespace-normal text-xs">{t.lastError}</div>}</TableCell>
                    <TableCell>{t.fetched}</TableCell><TableCell>{t.inserted}</TableCell><TableCell>{t.duplicates}</TableCell><TableCell className="text-xs">{fmtDateTime(t.lastScanAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{rows.length} run{rows.length === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No runs in this period.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Kind</TableHead><TableHead>Trigger</TableHead><TableHead>Outcome</TableHead><TableHead>Took</TableHead><TableHead>Counters</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.started_at)}</TableCell>
                    <TableCell>{r.kind}</TableCell><TableCell>{r.trigger}</TableCell>
                    <TableCell className="whitespace-normal"><Badge className={STATUS_STYLE[r.status] ?? ""}>{r.status}</Badge>{r.error && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{r.error}</div>}</TableCell>
                    <TableCell className="text-xs">{fmtDuration(r.started_at, r.finished_at) ?? (r.status === "running" ? "running" : "-")}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{Object.entries(r.stats ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "-"}</TableCell>
                    <TableCell><Link className="underline text-sm" href={`/logs/runs/${r.id}`}>Open</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {scans.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent scans</CardTitle><CardDescription>One row per source query.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead>Query</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>
                {scans.slice(0, 60).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.started_at)}</TableCell><TableCell>{portalLabel(s.integration)}</TableCell>
                    <TableCell>{s.country ? countryLabel(s.country) : "-"}</TableCell><TableCell>{s.query ?? "-"}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{s.status === "error" ? <span className="text-destructive">{s.error}</span> : `${s.fetched} fetched, ${s.inserted} new, ${s.duplicates} already known`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
