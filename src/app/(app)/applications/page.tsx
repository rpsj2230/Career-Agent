import Link from "next/link";
import { SourceBadge, StatusBadge } from "@/components/app/badges";
import { ListToolbar } from "@/components/app/list-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { activePills, APP_SORTS, APP_STAGES, appQueryParams, parseAppQuery, queryString, STAGES, type Link as QParams, type StageKey } from "@/lib/list-query";
import { filterOptions, listApplicationsFiltered } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { PipelineStatus } from "@/components/app/pipeline-status";
import { currentRole } from "@/lib/role-server";
import { PipelineStrip } from "@/components/app/pipeline-strip";
import { assistantPanelData } from "@/lib/apply/assistant-health";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { parsePaging } from "@/lib/pagination";
import { ActionButton } from "@/components/app/action-button";
import { SelectableTable } from "@/components/app/selectable-table";
import { applyRoute, nextStep } from "@/lib/apply/route";
import { draftStates } from "@/lib/apply/email-store";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const isAdmin = (await currentRole()) === "admin";
  const q = parseAppQuery(sp);
  const paging = parsePaging(sp);
  const [{ rows, total, totalAll, page, pages, shownFrom, shownTo, portalUnavailable, stageCounts: stageN }, opts, panel] = await Promise.all([listApplicationsFiltered(q, paging), filterOptions(), assistantPanelData().catch(() => null)]);
  const href = (over: QParams = {}) => `/applications${queryString(appQueryParams(q, { page: undefined, ...over }))}`;
  const ACTION: StageKey[] = ["awaiting_approval", "needs_input", "failed"];
  const sortHeader = (key: keyof typeof APP_SORTS, label: string) => {
    const active = q.sort === key;
    const next = active ? (q.dir === "asc" ? "desc" : "asc") : APP_SORTS[key].dir;
    return <Link key={key} href={href({ sort: key === "created" && next === "desc" ? undefined : key, dir: next === APP_SORTS[key].dir ? undefined : next })} className="inline-flex items-center gap-1 hover:underline" title={`Sort by ${APP_SORTS[key].label}`}>{label}<span aria-hidden className="text-xs">{active ? (q.dir === "asc" ? "▲" : "▼") : "↕"}</span></Link>;
  };
  const emails = await draftStates(rows.map((r) => r.id)).catch(() => new Map());
  const fmt = (d: string | null) => fmtDateTime(d);
  const route = (r: (typeof rows)[number]) => applyRoute({ apply_type: r.job?.apply_type, url: r.job?.url, portal: r.job?.portal, emailMode: emails.get(r.id)?.mode ?? null });
  const exportQuery = queryString(appQueryParams(q)).replace(/^\?/, "");
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <Button variant="outline" asChild><a href={`/api/export/applications${exportQuery ? `?${exportQuery}` : ""}`}>Export CSV</a></Button>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every application waits here for your OK (<b>prepared</b>). After you approve it: Greenhouse, Lever, Ashby and Workable are sent automatically from the cloud;
        LinkedIn, Naukri and Indeed need the <b>assistant on your computer</b> (they queue below until your computer is on); anything else is yours to submit.
      </p>
      {isAdmin && <PipelineStatus />}
      {isAdmin && <PipelineStrip />}
      {panel && <AssistantPanel {...panel} />}
      <ListToolbar
        kind="apps" action="/applications"
        chips={APP_STAGES.map((key) => ({ key, count: stageN[key] }))}
        presets={[{ label: "Needs my action", stages: ACTION, count: ACTION.reduce((n, k) => n + stageN[k], 0) }]}
        q={q}
        sorts={APP_SORTS} portals={opts.portals} countries={opts.countries}
        pills={activePills("apps", q, { portal: portalLabel, country: countryLabel, stage: (k) => STAGES[k].label }).map((p) => ({ ...p, href: href(p.over) }))}
        hrefs={{ all: href({ stage: undefined }), stage: Object.fromEntries(APP_STAGES.map((k) => [k, href({ stage: k })])), preset: [href({ stage: ACTION })], clear: "/applications" }}
        total={total} totalAll={totalAll}
        showing={`${total.toLocaleString("en-US")} application${total === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal filters are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card id="application-list" className="scroll-mt-4">
        <CardHeader><CardTitle>{total.toLocaleString("en-US")} application{total === 1 ? "" : "s"}{q.stages.length === 1 ? ` · ${STAGES[q.stages[0]].label}` : q.stages.length > 1 ? ` · ${q.stages.length} stages` : " · all statuses"}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/applications" sp={sp} size={paging.size} total={total} shownFrom={shownFrom} shownTo={shownTo} />
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here for these filters. Open a job from the review queue and prepare it.</p> : (
            <SelectableTable
              hint="Approving sends automatic ones from the cloud, emails the employer where an address is listed, and queues the rest for your assistant."
              actions={[{ label: "Approve and apply selected", action: "approve", confirm: "Approve and apply {n} application(s)? Anything that can be sent automatically will be sent." }, { label: "Write new resumes for selected", action: "regenerate", variant: "outline", confirm: "Write a new resume and cover letter for {n} application(s)? They go back to Pending approval and you approve them again (up to 20 at a time)." }, { label: "Apply again (same resume)", action: "reapply", variant: "outline", confirm: "Put {n} application(s) back to Pending approval with the same resume so you can approve them again?" }, { label: "Skip selected", action: "skip", variant: "outline", confirm: "Skip {n} application(s)?" }]}
              head={[<span key="r">{sortHeader("title", "Role")} · {sortHeader("company", "Company")}</span>, <span key="s">Source · {sortHeader("country", "Country")}</span>, sortHeader("stage", "Status"), "How it is applied", "Next step", "Reply", <span key="v">Resume · {sortHeader("created", "Prepared")} · {sortHeader("submitted", "Submitted")}</span>]}
              rows={rows.map((r) => ({
                id: r.id, selectId: ["prepared", "needs_input", "failed", "assisted_pending", "submitted"].includes(r.status) ? r.id : null,
                cells: [
                  <div key="r"><Link className="font-medium hover:underline" href={`/applications/${r.id}`}>{r.job?.title}</Link><div className="text-xs text-muted-foreground">{r.job?.company}</div></div>,
                  <div key="s"><SourceBadge portal={r.job?.portal} source={r.job?.source} /><div className="mt-1 text-xs text-muted-foreground">{countryLabel(r.job?.country)}</div></div>,
                  <StatusBadge key="st" status={r.status} />,
                  <span key="h" className="text-xs" title={route(r).detail}>{route(r).label}</span>,
                  (() => { const n = nextStep(r.status, route(r), r.id); return n.action === "assistant"
                    ? <div key="n" className="flex flex-col gap-1"><ActionButton endpoint="/api/assistant/run" success="Assistant asked to run" size="sm" disabled={panel?.pending}>{panel?.pending ? (panel.online ? "Requested: starting" : "Requested: assistant not running") : n.text}</ActionButton><span className="text-xs text-muted-foreground">{panel?.online ? "Assistant is running; starts within ~30 s." : "The assistant is not running on your computer yet (see the card above for setup)."}</span></div>
                    : n.href ? <Link key="n" className="text-sm underline" href={n.href}>{n.text}</Link> : <span key="n" className="text-sm text-muted-foreground">{n.text}</span>; })(),
                  r.lifecycle === "none" ? "-" : <Badge key="l">{r.lifecycle}</Badge>,
                  <div key="v" className="text-xs"><Link className="underline" href={`/applications/${r.id}#documents`} target="_blank" rel="noreferrer">View resume v{r.resume?.version ?? "?"}</Link><div><Link className="underline" href={`/applications/${r.id}#regenerate`}>New resume / apply again</Link></div><div className="text-muted-foreground">{fmt(r.submitted_at)}</div></div>,
                ],
              }))}
            />
          )}
          <Pagination basePath="/applications" sp={sp} page={page} pages={pages} size={paging.size} />
        </CardContent>
      </Card>
    </div>
  );
}
