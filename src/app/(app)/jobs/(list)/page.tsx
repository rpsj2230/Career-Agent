import { Suspense } from "react";
import { CardSkeleton } from "@/components/app/card-skeleton";
import Link from "next/link";
import { AddJob } from "@/components/app/add-job";
import { PipelineStatus } from "@/components/app/pipeline-status";
import { currentRole } from "@/lib/role-server";
import { ActionButton } from "@/components/app/action-button";
import { ScoreBadge, SourceBadge, StageBadge } from "@/components/app/badges";
import { BackgroundBanner } from "@/components/app/background-banner";
import { SearchSummary } from "@/components/app/search-summary";
import { ListToolbar } from "@/components/app/list-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countryLabel } from "@/lib/filters";
import { portalLabel, viaLabel } from "@/lib/jobs/portal";
import { activePills, JOB_DEFAULT_STAGES, JOB_GROUPS, JOB_SORTS, jobQueryParams, parseJobQuery, queryString, STAGE_ORDER, STAGES, type Link as QParams } from "@/lib/list-query";
import { applicationsForJobs, counts, filterOptions, listJobsFiltered, scoreOf } from "@/lib/queries";
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
  const href = (over: QParams = {}) => `/jobs${queryString(jobQueryParams(q, { page: undefined, ...over }))}`;
  const sortHeader = (key: keyof typeof JOB_SORTS, label: string) => {
    const active = q.sort === key;
    const next = active ? (q.dir === "asc" ? "desc" : "asc") : JOB_SORTS[key].dir;
    return <Link key={key} href={href({ sort: key === "score" && next === "desc" ? undefined : key, dir: next === JOB_SORTS[key].dir ? undefined : next })} className="inline-flex items-center gap-1 hover:underline" title={`Sort by ${JOB_SORTS[key].label}`}>{label}<span aria-hidden className="text-xs">{active ? (q.dir === "asc" ? "▲" : "▼") : "↕"}</span></Link>;
  };
  const groups = JOB_GROUPS.map((g) => ({
    key: g.key, label: g.label, hint: g.hint, count: g.stages.reduce((n, k) => n + stageN[k], 0), href: href({ stage: g.stages }),
    active: q.stages.length === g.stages.length && g.stages.every((k) => q.stages.includes(k)),
  }));
  const groupLabel = JOB_GROUPS.find((g) => q.stages.length === g.stages.length && g.stages.every((k) => q.stages.includes(k)))?.label;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Jobs found &amp; scored</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Every job the agent has found, with its fit score and where it stands now. Applications (resume, approval, sending) are on the <Link className="underline" href="/applications">Applications</Link> page. Your schedule finds and scores by itself; the buttons do a step right now.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <AddJob />
          <ActionButton method="POST" endpoint="/api/run/discover" success="Started" title="Looks on every connected job site for new postings that match your roles and countries, then scores them. New postings appear under 'Not scored yet' until scored.">Search job sites now</ActionButton>
          <ActionButton variant="outline" method="POST" endpoint="/api/run/score" success="Started" title="Rates every job that is still 'Not scored yet' from 0 to 100 against your profile. Jobs at or above your threshold become a good fit.">Score unscored jobs</ActionButton>
        </div>
      </div>
      {isAdmin && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">How the pipeline is doing (what is waiting and why)</summary>
          <div className="mt-3 grid gap-4">
            <Suspense fallback={<CardSkeleton height="h-64" />}><PipelineStatus /></Suspense>
            <BackgroundBanner />
            <SearchSummary />
          </div>
        </details>
      )}
      {!(q.stages.length === 1 && q.stages[0] === "unscored") && c.fresh > 0 && (
        <Alert><AlertDescription>
          <b>{c.fresh} new job{c.fresh === 1 ? " is" : "s are"} waiting to be scored.</b> The next scheduled run scores them, or press <i>Score unscored jobs</i>.{" "}
          <Link className="underline" href="/jobs?stage=unscored">See them</Link>
        </AlertDescription></Alert>
      )}
      <ListToolbar
        kind="jobs" action="/jobs"
        chips={STAGE_ORDER.map((key) => ({ key, count: stageN[key] }))}
        groups={groups}
        presets={[]}
        q={{ ...q, methods: q.methods }}
        sorts={JOB_SORTS} portals={opts.portals} vias={opts.vias} countries={opts.countries}
        pills={activePills("jobs", q, { portal: portalLabel, via: viaLabel, country: countryLabel, stage: (k) => STAGES[k].label }, JOB_DEFAULT_STAGES).map((p) => ({ ...p, href: href(p.over) }))}
        hrefs={{ all: href({ stage: undefined }), stage: Object.fromEntries(STAGE_ORDER.map((k) => [k, href({ stage: k })])), preset: [], clear: "/jobs" }}
        total={total} totalAll={totalAll}
        showing={`${total.toLocaleString("en-US")} job${total === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal details are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{total.toLocaleString("en-US")} job{total === 1 ? "" : "s"} · {groupLabel ?? (q.stages.length === 0 ? "all jobs" : `${q.stages.length} stages`)}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/jobs" sp={sp} size={paging.size} total={total} shownFrom={shownFrom} shownTo={shownTo} />
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here for these filters. Run discovery, add a job you found yourself, or change the filters.</p>
          ) : (
            <SelectableTable
              hint="Good-fit jobs get their resume written automatically, a few every hour."
              actions={[{ label: "Prepare resumes for selected", action: "prepare" }]}
              head={[sortHeader("score", "Score"), <span key="r">{sortHeader("title", "Job")} · {sortHeader("company", "Company")}</span>, <span key="w">Where · {sortHeader("country", "Country")}</span>, <span key="f">Found via · {sortHeader("found", "Date")}</span>, "Where it stands"]}
              rows={jobs.map((j) => {
                const app = appByJob.get(j.id);
                const waiting = !app && ["queued", "saved"].includes(j.status);
                const stage = stageOf.get(j.id) ?? "matched";
                return {
                  id: j.id, selectId: waiting ? j.id : null,
                  cells: [
                    <ScoreBadge key="s" score={scoreOf(j)?.score} />,
                    <div key="r" className="max-w-sm"><Link href={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link><div className="text-xs text-muted-foreground">{j.company}</div></div>,
                    <div key="w" className="text-sm">{j.location ?? countryLabel(j.country)}<div className="text-xs text-muted-foreground">{j.country ? countryLabel(j.country) : ""}</div></div>,
                    <div key="f"><SourceBadge portal={j.portal} source={j.source} /><div className="mt-1 text-xs text-muted-foreground">{fmtDate(j.found_at)}</div></div>,
                    <div key="n" className="grid max-w-xs gap-1">
                      <div><StageBadge stage={stage} /></div>
                      {stage === "rejected" ? <span className="text-xs text-muted-foreground">{j.skip_reason ?? "Closed out by the score or your rules."}</span>
                        : app ? <Link className="text-xs underline" href={`/applications/${app.id}`}>{stage === "awaiting_approval" ? "Open the application: review and approve" : stage === "needs_input" || stage === "failed" ? "Open: finish it yourself (form link, answers, resume)" : "Open the application"}</Link>
                        : waiting ? <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">Resume is written automatically <ActionButton size="sm" variant="outline" endpoint={`/api/jobs/${j.id}/prepare`} success="Preparing">Prepare now</ActionButton></span>
                        : stage === "unscored" ? <span className="text-xs text-muted-foreground">Waiting for its fit score</span> : null}
                    </div>,
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
