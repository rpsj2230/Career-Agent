import { Suspense } from "react";
import { CardSkeleton } from "@/components/app/card-skeleton";
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
import { ListToolbar } from "@/components/app/list-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countryLabel } from "@/lib/filters";
import { portalLabel, viaLabel } from "@/lib/jobs/portal";
import { activePills, JOB_DEFAULT_STAGES, JOB_SORTS, jobQueryParams, parseJobQuery, queryString, STAGE_ORDER, STAGES, type Link as QParams, type StageKey } from "@/lib/list-query";
import { applicationsForJobs, counts, filterOptions, listJobsFiltered, scoreOf } from "@/lib/queries";
import { applyRoute } from "@/lib/apply/route";
import { SelectableTable } from "@/components/app/selectable-table";
import { fmtDate } from "@/lib/time";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { parsePaging } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const isAdmin = (await currentRole()) === "admin";
  const q = parseJobQuery(sp);
  const paging = parsePaging(sp);
  const [{ rows: jobs, total, totalAll, page, pages, shownFrom, shownTo, portalUnavailable, stageCounts: stageN, stageOf }, opts, c] = await Promise.all([listJobsFiltered(q, paging), filterOptions(), counts().catch(() => ({ fresh: 0 }))]);
  const appByJob = await applicationsForJobs(jobs.map((j) => j.id)).catch(() => new Map<string, { id: string; status: string }>());
  const showReasons = q.stages.length === 1 && q.stages[0] === "rejected";
  const href = (over: QParams = {}) => `/jobs${queryString(jobQueryParams(q, { page: undefined, ...over }))}`;
  const ACTION: StageKey[] = ["awaiting_approval", "needs_input", "failed"];
  const sortHeader = (key: keyof typeof JOB_SORTS, label: string) => {
    const active = q.sort === key;
    const next = active ? (q.dir === "asc" ? "desc" : "asc") : JOB_SORTS[key].dir;
    return <Link key={key} href={href({ sort: key === "score" && next === "desc" ? undefined : key, dir: next === JOB_SORTS[key].dir ? undefined : next })} className="inline-flex items-center gap-1 hover:underline" title={`Sort by ${JOB_SORTS[key].label}`}>{label}<span aria-hidden className="text-xs">{active ? (q.dir === "asc" ? "▲" : "▼") : "↕"}</span></Link>;
  };
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
      {isAdmin && <Suspense fallback={<CardSkeleton height="h-64" />}><PipelineStatus /></Suspense>}
      {isAdmin && <BackgroundBanner />}
      {isAdmin && <Suspense fallback={<CardSkeleton />}><BacklogCard /></Suspense>}
      {isAdmin && <Suspense fallback={<CardSkeleton />}><PipelineStrip /></Suspense>}
      <SearchSummary />
      {!(q.stages.length === 1 && q.stages[0] === "unscored") && c.fresh > 0 && (
        <Alert><AlertDescription>
          <b>{c.fresh} new job{c.fresh === 1 ? " is" : "s are"} waiting to be scored</b> and do not show in this list yet. The next scheduled run scores them, or press <i>Score new jobs</i>.{" "}
          <Link className="underline" href="/jobs?stage=unscored">See them</Link>
        </AlertDescription></Alert>
      )}
      <ListToolbar
        kind="jobs" action="/jobs"
        chips={STAGE_ORDER.map((key) => ({ key, count: stageN[key] }))}
        presets={[{ label: "Needs my action", stages: ACTION, count: ACTION.reduce((n, k) => n + stageN[k], 0) }]}
        q={{ ...q, methods: q.methods }}
        sorts={JOB_SORTS} portals={opts.portals} vias={opts.vias} countries={opts.countries}
        pills={activePills("jobs", q, { portal: portalLabel, via: viaLabel, country: countryLabel, stage: (k) => STAGES[k].label }, JOB_DEFAULT_STAGES).map((p) => ({ ...p, href: href(p.over) }))}
        hrefs={{ all: href({ stage: "all" }), stage: Object.fromEntries(STAGE_ORDER.map((k) => [k, href({ stage: k })])), preset: [href({ stage: ACTION })], clear: "/jobs" }}
        total={total} totalAll={totalAll}
        showing={`${total.toLocaleString("en-US")} job${total === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal details are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{total.toLocaleString("en-US")} job{total === 1 ? "" : "s"}{q.stages.length === 1 ? ` · ${STAGES[q.stages[0]].label}` : q.stages.length > 1 ? ` · ${q.stages.length} stages` : " · all stages"}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/jobs" sp={sp} size={paging.size} total={total} shownFrom={shownFrom} shownTo={shownTo} />
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here for these filters. Run discovery, add a job you found yourself, or change the filters.</p>
          ) : (
            <SelectableTable
              hint="Matched jobs are also prepared automatically, a few every hour."
              actions={[{ label: "Prepare resumes for selected", action: "prepare" }]}
              head={[sortHeader("score", "Fit"), <span key="r">{sortHeader("title", "Role")} · {sortHeader("company", "Company")} · {sortHeader("found", "Found")}</span>, "Source", <span key="w">Where · {sortHeader("country", "Country")}</span>, "How it is applied", showReasons ? "Why rejected" : <span key="n">Resume and next step · {sortHeader("stage", "Stage")}</span>]}
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
                        ) : <span className="text-xs">{STAGES[stageOf.get(j.id) ?? "matched"].label}</span>}
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
