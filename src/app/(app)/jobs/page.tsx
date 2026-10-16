import Link from "next/link";
import { AddJob } from "@/components/app/add-job";
import { ActionButton } from "@/components/app/action-button";
import { ApplyTypeBadge, ScoreBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { FilterBar } from "@/components/app/filter-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel, JOB_VIEWS, parseJobFilters } from "@/lib/filters";
import { filterOptions, listJobs, scoreOf } from "@/lib/queries";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseJobFilters(await searchParams);
  const [{ rows: jobs, portalUnavailable }, opts] = await Promise.all([listJobs(f), filterOptions()]);
  const showReasons = f.view === "skipped";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <div className="flex flex-wrap gap-2">
          <AddJob />
          <ActionButton variant="outline" method="GET" endpoint="/api/cron/score" success="Scoring batch finished">Score new jobs</ActionButton>
          <ActionButton method="GET" endpoint="/api/cron/discover" success="Discovery finished">Find jobs now</ActionButton>
        </div>
      </div>
      <FilterBar
        action="/jobs" statusName="view" status={f.view}
        statusOptions={Object.entries(JOB_VIEWS).map(([key, v]) => ({ key, label: v.label }))}
        portals={opts.portals} countries={opts.countries} portal={f.portal} country={f.country} q={f.q}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal details are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{jobs.length} job{jobs.length === 1 ? "" : "s"} · {JOB_VIEWS[f.view].label}</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here for these filters. Run discovery, add a job you found yourself, or change the filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Fit</TableHead><TableHead>Role</TableHead><TableHead>Source</TableHead><TableHead>Where</TableHead><TableHead>Apply path</TableHead><TableHead>{showReasons ? "Why rejected" : "Status"}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell><ScoreBadge score={scoreOf(j)?.score} /></TableCell>
                    <TableCell className="max-w-sm whitespace-normal">
                      <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
                      <div className="text-xs text-muted-foreground">{j.company} · found {fmtDate(j.found_at)}</div>
                    </TableCell>
                    <TableCell><SourceBadge portal={j.portal} source={j.source} /></TableCell>
                    <TableCell className="text-sm">{j.location ?? countryLabel(j.country)}<div className="text-xs text-muted-foreground">{j.country ? countryLabel(j.country) : ""}</div></TableCell>
                    <TableCell><ApplyTypeBadge type={j.apply_type} /></TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm">{showReasons ? (j.skip_reason ?? "-") : <StatusBadge status={j.status} />}</TableCell>
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
