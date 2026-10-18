import Link from "next/link";
import { AddJob } from "@/components/app/add-job";
import { ActionButton } from "@/components/app/action-button";
import { ApplyTypeBadge, ScoreBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { BackgroundBanner } from "@/components/app/background-banner";
import { FilterBar } from "@/components/app/filter-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel, JOB_VIEWS, parseJobFilters } from "@/lib/filters";
import { counts, filterOptions, listJobs, scoreOf } from "@/lib/queries";
import { fmtDate } from "@/lib/time";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { parsePaging } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseJobFilters(sp);
  const paging = parsePaging(sp);
  const [{ rows: jobs, total, page, pages, shownFrom, shownTo, portalUnavailable }, opts, c] = await Promise.all([listJobs(f, paging), filterOptions(), counts().catch(() => ({ fresh: 0 }))]);
  const showReasons = f.view === "skipped";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <div className="flex flex-wrap gap-2">
          <AddJob />
          <ActionButton variant="outline" method="POST" endpoint="/api/run/score" success="Started">Score new jobs</ActionButton>
          <ActionButton method="POST" endpoint="/api/run/discover" success="Started">Find jobs now</ActionButton>
        </div>
      </div>
      <BackgroundBanner />
      {f.view !== "new" && c.fresh > 0 && (
        <Alert><AlertDescription>
          <b>{c.fresh} new job{c.fresh === 1 ? " is" : "s are"} waiting to be scored</b> and do not show in this list yet. The next scheduled run scores them, or press <i>Score new jobs</i>.{" "}
          <Link className="underline" href="/jobs?view=new">See them</Link>
        </AlertDescription></Alert>
      )}
      <FilterBar
        action="/jobs" statusName="view" status={f.view}
        statusOptions={Object.entries(JOB_VIEWS).map(([key, v]) => ({ key, label: v.label }))}
        portals={opts.portals} countries={opts.countries} portal={f.portal} country={f.country} q={f.q}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal details are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{total} job{total === 1 ? "" : "s"} · {JOB_VIEWS[f.view].label}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/jobs" sp={sp} size={paging.size} total={total} shownFrom={shownFrom} shownTo={shownTo} />
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
          <Pagination basePath="/jobs" sp={sp} page={page} pages={pages} size={paging.size} />
        </CardContent>
      </Card>
    </div>
  );
}
