import Link from "next/link";
import { AddJob } from "@/components/app/add-job";
import { PipelineStatus } from "@/components/app/pipeline-status";
import { currentRole } from "@/lib/role-server";
import { ActionButton } from "@/components/app/action-button";
import { ScoreBadge, SourceBadge, StatusBadge } from "@/components/app/badges";
import { BackgroundBanner } from "@/components/app/background-banner";
import { BacklogCard } from "@/components/app/backlog-card";
import { PipelineStrip } from "@/components/app/pipeline-strip";
import { SearchSummary } from "@/components/app/search-summary";
import { FilterBar } from "@/components/app/filter-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countryLabel, JOB_VIEWS, parseJobFilters } from "@/lib/filters";
import { applicationsForJobs, counts, filterOptions, listJobs, scoreOf } from "@/lib/queries";
import { applyRoute } from "@/lib/apply/route";
import { SelectableTable } from "@/components/app/selectable-table";
import { fmtDate } from "@/lib/time";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { parsePaging } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const isAdmin = (await currentRole()) === "admin";
  const f = parseJobFilters(sp);
  const paging = parsePaging(sp);
  const [{ rows: jobs, total, page, pages, shownFrom, shownTo, portalUnavailable }, opts, c] = await Promise.all([listJobs(f, paging), filterOptions(), counts().catch(() => ({ fresh: 0 }))]);
  const appByJob = await applicationsForJobs(jobs.map((j) => j.id)).catch(() => new Map<string, { id: string; status: string }>());
  const showReasons = f.view === "skipped";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Jobs found &amp; scored</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Jobs move left to right: <b>found</b> on the job sites, <b>scored</b> against your profile, then a <b>resume is prepared</b> for the good ones. Your schedule does all of this by itself, and the hourly check clears any backlog; the buttons are for doing a step right now. To run the whole schedule now (search, score, prepare, apply), use <Link className="underline" href="/schedules">Schedules</Link> → <i>Run this schedule now</i>.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <AddJob />
          <ActionButton method="POST" endpoint="/api/run/discover" success="Started" title="Looks on every connected job site for new postings that match your roles and countries, then scores them. New postings appear under 'Found, not scored' until scored.">Search job sites now</ActionButton>
          <ActionButton variant="outline" method="POST" endpoint="/api/run/score" success="Started" title="Rates every job that is still 'Found, not scored' from 0 to 100 against your profile. Jobs at or above your threshold move to the matched list.">Score unscored jobs</ActionButton>
      </div>
      </div>
      {isAdmin && <PipelineStatus />}
      {isAdmin && <BackgroundBanner />}
      {isAdmin && <BacklogCard />}
      {isAdmin && <PipelineStrip />}
      <SearchSummary />
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
            <SelectableTable
              hint="Matched jobs are also prepared automatically, a few every hour."
              actions={[{ label: "Prepare resumes for selected", action: "prepare" }]}
              head={["Fit", "Role", "Source", "Where", "How it is applied", showReasons ? "Why rejected" : "Resume and next step"]}
              rows={jobs.map((j) => {
                const app = appByJob.get(j.id);
                const route = applyRoute({ apply_type: j.apply_type, url: j.url });
                const waiting = !app && ["queued", "saved"].includes(j.status);
                return {
                  id: j.id, selectId: waiting ? j.id : null,
                  cells: [
                    <ScoreBadge key="s" score={scoreOf(j)?.score} />,
                    <div key="r" className="max-w-sm"><Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link><div className="text-xs text-muted-foreground">{j.company} · found {fmtDate(j.found_at)}</div></div>,
                    <SourceBadge key="src" portal={j.portal} source={j.source} />,
                    <div key="w" className="text-sm">{j.location ?? countryLabel(j.country)}<div className="text-xs text-muted-foreground">{j.country ? countryLabel(j.country) : ""}</div></div>,
                    <span key="a" className="text-xs" title={route.detail}>{route.label}</span>,
                    showReasons ? <span key="x" className="max-w-xs text-sm">{j.skip_reason ?? "-"}</span> : (
                      <div key="n" className="flex flex-wrap items-center gap-2">
                        {app ? (
                          <>
                            <StatusBadge status={app.status} />
                            <Link className="text-sm underline" href={`/applications/${app.id}#documents`} target="_blank" rel="noreferrer">View resume</Link>
                            {app.status === "prepared" && <ActionButton size="sm" endpoint={`/api/applications/${app.id}`} body={{ action: "approve" }} success="Approved">{route.kind === "cloud" ? "Approve and apply" : route.kind === "assistant" ? "Approve (assistant applies)" : route.kind === "email" ? "Approve and send email" : "Approve (I submit)"}</ActionButton>}
                          </>
                        ) : waiting ? (
                          <>
                            <span className="text-xs text-muted-foreground">Resume not prepared yet (automatic)</span>
                            <ActionButton size="sm" variant="outline" endpoint={`/api/jobs/${j.id}/prepare`} success="Preparing">Prepare now</ActionButton>
                          </>
                        ) : <StatusBadge status={j.status} />}
                      </div>
                    ),
                  ],
                };
              })}
            />
          )}
          <Pagination basePath="/jobs" sp={sp} page={page} pages={pages} size={paging.size} />
        </CardContent>
      </Card>
    </div>
  );
}
