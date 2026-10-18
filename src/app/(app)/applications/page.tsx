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
import { AssistantPanel } from "@/components/app/assistant-panel";
import { PipelineStrip } from "@/components/app/pipeline-strip";
import { assistantPanelData } from "@/lib/apply/assistant-health";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { parsePaging } from "@/lib/pagination";
import { ActionButton } from "@/components/app/action-button";
import { applyRoute, nextStep } from "@/lib/apply/route";
import { draftStates } from "@/lib/apply/email-store";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
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
      <PipelineStrip />
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
            <Table>
              <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Source · country</TableHead><TableHead>Status</TableHead><TableHead>How it is applied</TableHead><TableHead>Next step</TableHead><TableHead>Reply</TableHead><TableHead>Resume · submitted</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal"><Link className="font-medium hover:underline" href={`/applications/${r.id}`}>{r.job?.title}</Link><div className="text-xs text-muted-foreground">{r.job?.company}</div></TableCell>
                    <TableCell className="whitespace-normal"><SourceBadge portal={r.job?.portal} source={r.job?.source} /><div className="mt-1 text-xs text-muted-foreground">{countryLabel(r.job?.country)}</div></TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="whitespace-normal text-xs" title={route(r).detail}>{route(r).label}</TableCell>
                    <TableCell className="whitespace-normal">
                      {(() => { const n = nextStep(r.status, route(r), r.id); return n.action === "assistant"
                        ? <div className="flex flex-col gap-1"><ActionButton endpoint="/api/assistant/run" success="Assistant asked to run" size="sm" disabled={panel?.pending}>{panel?.pending ? "Requested" : n.text}</ActionButton><span className="text-xs text-muted-foreground">{panel?.online ? "Assistant is running; starts within ~30 s." : "Starts when your computer is on."}</span></div>
                        : n.href ? <Link className="text-sm underline" href={n.href}>{n.text}</Link> : <span className="text-sm text-muted-foreground">{n.text}</span>; })()}
                    </TableCell>
                    <TableCell>{r.lifecycle === "none" ? "-" : <Badge>{r.lifecycle}</Badge>}</TableCell>
                    <TableCell className="whitespace-normal text-xs">v{r.resume?.version ?? "?"}<div className="text-muted-foreground">{fmt(r.submitted_at)}</div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination basePath="/applications" sp={sp} page={page} pages={pages} size={paging.size} />
        </CardContent>
      </Card>
    </div>
  );
}
