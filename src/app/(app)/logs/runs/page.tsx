import Link from "next/link";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { pageRange, parsePaging } from "@/lib/pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { applyLogs, listRuns, recentScans } from "@/lib/log-queries";
import { ApplyReportCard } from "@/components/app/apply-report-card";
import { applyReport, windowLabel } from "@/lib/run-report";
import { RunsTable } from "@/components/app/runs-table";
import { summarizeScans } from "@/lib/scan-summary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appTimezone, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const sel = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tz = appTimezone();
  const status = ["running", "succeeded", "partial", "failed", "cancelled"].includes(one(sp.status) ?? "") ? one(sp.status) : undefined;
  const kind = ["pipeline", "scan", "score", "prepare", "apply", "report"].includes(one(sp.kind) ?? "") ? one(sp.kind) : undefined;
  const from = date(one(sp.from)), to = date(one(sp.to));
  const paging = parsePaging(sp);
  const [{ rows, missing, total }, scans, applyRows] = await Promise.all([listRuns({ status, kind, from, to, tz, limit: paging.size, page: paging.page }), recentScans({ from, to, tz }), applyLogs({ from, to, tz })]);
  const rng = pageRange(total, paging.page, paging.size);
  const applying = applyReport(applyRows, portalLabel, countryLabel);
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

      <ApplyReportCard report={applying} title="How applying went" description="Applications in the selected period: how many were submitted, who approved them, through which portal and in which country." />

      <Card>
        <CardHeader><CardTitle>{total} run{total === 1 ? "" : "s"}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/logs/runs" sp={sp} size={paging.size} total={total} shownFrom={rng.shownFrom} shownTo={rng.shownTo} />
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No runs in this period.</p> : (
            <div className="overflow-x-auto"><RunsTable runs={rows} /></div>
          )}
        <Pagination basePath="/logs/runs" sp={sp} page={rng.page} pages={rng.pages} size={paging.size} />
        </CardContent>
      </Card>

      {scans.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent scans</CardTitle><CardDescription>One row per source query.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead>Query</TableHead><TableHead>Postings asked for</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>
                {scans.slice(0, 60).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.started_at)}</TableCell><TableCell>{portalLabel(s.integration)}</TableCell>
                    <TableCell>{s.country ? countryLabel(s.country) : "-"}</TableCell><TableCell>{s.query ?? "-"}</TableCell><TableCell className="whitespace-nowrap text-xs">{windowLabel(s.detail, tz) ?? "-"}</TableCell>
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
