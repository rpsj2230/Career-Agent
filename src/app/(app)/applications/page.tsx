import Link from "next/link";
import { SourceBadge, StatusBadge } from "@/components/app/badges";
import { FilterBar } from "@/components/app/filter-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_STATUSES, countryLabel, parseAppFilters } from "@/lib/filters";
import { filterOptions, listApplications } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { AssistantPanel } from "@/components/app/assistant-panel";
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
  const f = parseAppFilters(sp);
  const paging = parsePaging(sp);
  const [{ rows, total, page, pages, shownFrom, shownTo, portalUnavailable }, opts, panel] = await Promise.all([listApplications(f, paging), filterOptions(), assistantPanelData().catch(() => null)]);
  const emails = await draftStates(rows.map((r) => r.id)).catch(() => new Map());
  const fmt = (d: string | null) => fmtDateTime(d);
  const route = (r: (typeof rows)[number]) => applyRoute({ apply_type: r.job?.apply_type, url: r.job?.url, portal: r.job?.portal, emailMode: emails.get(r.id)?.mode ?? null });
  const exportQuery = new URLSearchParams(Object.entries({ portal: f.portal, country: f.country }).filter(([, v]) => v) as [string, string][]).toString();
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
      {isAdmin && <PipelineStrip />}
      {panel && <AssistantPanel {...panel} />}
      <FilterBar
        action="/applications" statusName="status" status={f.status}
        statusOptions={Object.entries(APP_STATUSES).map(([key, v]) => ({ key, label: v.label }))}
        portals={opts.portals} countries={opts.countries} portal={f.portal} country={f.country} q={f.q}
      />
      {portalUnavailable && <Alert><AlertDescription>Portal filters are not available until the database update is applied (see System).</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>{total} application{total === 1 ? "" : "s"} · {APP_STATUSES[f.status].label}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <PageSizeBar basePath="/applications" sp={sp} size={paging.size} total={total} shownFrom={shownFrom} shownTo={shownTo} />
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here for these filters. Open a job from the review queue and prepare it.</p> : (
            <SelectableTable
              hint="Approving sends automatic ones from the cloud, emails the employer where an address is listed, and queues the rest for your assistant."
              actions={[{ label: "Approve and apply selected", action: "approve", confirm: "Approve and apply {n} application(s)? Anything that can be sent automatically will be sent." }, { label: "Write new resumes for selected", action: "regenerate", variant: "outline", confirm: "Write a new resume and cover letter for {n} application(s)? They go back to Pending approval and you approve them again (up to 20 at a time)." }, { label: "Apply again (same resume)", action: "reapply", variant: "outline", confirm: "Put {n} application(s) back to Pending approval with the same resume so you can approve them again?" }, { label: "Skip selected", action: "skip", variant: "outline", confirm: "Skip {n} application(s)?" }]}
              head={["Role", "Source · country", "Status", "How it is applied", "Next step", "Reply", "Resume · submitted"]}
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
