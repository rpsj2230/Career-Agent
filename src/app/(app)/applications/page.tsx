import Link from "next/link";
import { SourceBadge, StatusBadge } from "@/components/app/badges";
import { FilterBar } from "@/components/app/filter-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APP_STATUSES, countryLabel, parseAppFilters } from "@/lib/filters";
import { filterOptions, listApplications } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseAppFilters(await searchParams);
  const [{ rows, portalUnavailable }, opts] = await Promise.all([listApplications(f), filterOptions()]);
  const fmt = (d: string | null) => fmtDateTime(d);
  const exportQuery = new URLSearchParams(Object.entries({ portal: f.portal, country: f.country }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <Button variant="outline" asChild><a href={`/api/export/applications${exportQuery ? `?${exportQuery}` : ""}`}>Export CSV</a></Button>
      </div>
      <FilterBar
        action="/applications" statusName="status" status={f.status}
        statusOptions={Object.entries(APP_STATUSES).map(([key, v]) => ({ key, label: v.label }))}
        portals={opts.portals} countries={opts.countries} portal={f.portal} country={f.country} q={f.q}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal filters are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{rows.length} application{rows.length === 1 ? "" : "s"} · {APP_STATUSES[f.status].label}</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here for these filters. Open a job from the review queue and prepare it.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead>Status</TableHead><TableHead>Method</TableHead><TableHead>Outcome</TableHead><TableHead>Resume</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal"><Link className="font-medium hover:underline" href={`/applications/${r.id}`}>{r.job?.title}</Link><div className="text-xs text-muted-foreground">{r.job?.company}</div></TableCell>
                    <TableCell><SourceBadge portal={r.job?.portal} source={r.job?.source} /></TableCell>
                    <TableCell className="text-sm">{countryLabel(r.job?.country)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell>{r.method ? <Badge variant="secondary">{r.method}</Badge> : "-"}</TableCell>
                    <TableCell>{r.lifecycle === "none" ? "-" : <Badge>{r.lifecycle}</Badge>}</TableCell>
                    <TableCell>v{r.resume?.version ?? "?"}</TableCell>
                    <TableCell className="text-sm">{fmt(r.submitted_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
