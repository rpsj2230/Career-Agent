import Link from "next/link";
import { ConnectionBadge } from "@/components/app/status-badge";
import { CredentialsDialog, EnabledSwitch, IntegrationActions } from "@/components/app/integration-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApifyActors } from "@/components/app/apify-actors";
import { getSetting } from "@/lib/settings";
import { integrationById } from "@/lib/integrations/catalog";
import { loadPortalsView } from "@/lib/integrations/view";
import { portalLabel } from "@/lib/jobs/portal";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const when = (d: string | null | undefined) => fmtDateTime(d, undefined, "never");
const APPLY = { automated: "Auto-apply where allowed", assisted: "You submit", none: "n/a" } as const;

export default async function PortalsPage() {
  const [v, apify] = await Promise.all([loadPortalsView(), getSetting("apify")]);
  const working = v.portals.filter((p) => p.status === "ok").length;
  const feeds = v.integrations.filter((i) => i.def.discovers && i.def.available);
  const feedsOk = feeds.filter((i) => i.status === "ok").length;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Job portals and sources</h1>
        <p className="text-sm text-muted-foreground">{working} of {v.portals.length} portals receiving jobs · {feedsOk} of {feeds.length} scanning sources working · {v.totalJobs} jobs stored in total</p>
      </div>

      {v.schemaMissing && (
        <Alert variant="destructive"><AlertTitle>Database update needed</AlertTitle><AlertDescription>Connection status and scan history cannot be saved until the update is applied. <Link className="underline" href="/system">Open System</Link>.</AlertDescription></Alert>
      )}

      <Alert>
        <AlertTitle>How portals are connected</AlertTitle>
        <AlertDescription>LinkedIn, Indeed, Glassdoor and Naukri have no open job-search or apply API for individuals, and their terms forbid scraping and automated applying, so this app never logs in to them or scrapes them. Their listings reach you through a feed that reads published postings, through alert emails, or by manual add. Automatic applying is offered only on company career pages (Greenhouse, Lever).</AlertDescription>
      </Alert>

      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Job portals</h2>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Portal</TableHead><TableHead>Status</TableHead><TableHead>Jobs found</TableHead><TableHead>Last job seen</TableHead><TableHead>Applying</TableHead></TableRow></TableHeader>
              <TableBody>
                {v.portals.map((p) => (
                  <TableRow key={p.def.key}>
                    <TableCell className="whitespace-normal align-top">
                      <div className="font-medium">{p.def.name}</div>
                      <div className="text-xs text-muted-foreground">{p.note}</div>
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Routes and limits</summary>
                        <div className="mt-1 flex flex-wrap gap-1">{p.def.via.map((id) => <Badge key={id} variant="outline">{integrationById(id)?.name}</Badge>)}</div>
                        <ul className="mt-1 list-disc pl-4">{p.def.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                      </details>
                    </TableCell>
                    <TableCell className="align-top"><ConnectionBadge status={p.status} /></TableCell>
                    <TableCell className="align-top">{p.jobs > 0 ? <Link className="underline" href={`/jobs?portal=${p.def.key}&status=all`}>{p.jobs}</Link> : 0}</TableCell>
                    <TableCell className="align-top text-sm">{when(p.lastSeen)}</TableCell>
                    <TableCell className="whitespace-normal align-top text-xs"><div className="font-medium">{APPLY[p.def.apply]}</div><div className="text-muted-foreground">{p.def.applyNote}</div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {v.otherPortals.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">Also seen: {v.otherPortals.map((o) => `${portalLabel(o.key)} (${o.jobs})`).join(", ")}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Sources (how listings reach the system)</h2>
        {v.integrations.map((i) => (
          <Card key={i.def.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">{i.def.name} <ConnectionBadge status={i.status} /></CardTitle>
                  <CardDescription>{i.def.kind}. {i.def.summary}</CardDescription>
                </div>
                {i.def.available && (
                  <div className="flex flex-wrap items-center gap-2">
                    {i.def.id !== "manual" && <EnabledSwitch id={i.def.id} enabled={i.state?.enabled ?? true} />}
                    {i.def.credentials.length > 0 && <CredentialsDialog id={i.def.id} name={i.def.name} credentials={i.def.credentials} saved={i.sources} />}
                    {i.def.id !== "manual" && <IntegrationActions id={i.def.id} discovers={i.def.discovers} />}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div><div className="mb-1 font-medium">To connect</div><ol className="list-decimal pl-5 text-muted-foreground">{i.def.setup.map((s) => <li key={s}>{s}</li>)}</ol>
                  {i.def.needsConfig === "apify_actors" && <p className="mt-1 text-xs">Scrapers are set up below.</p>}
                  {i.def.needsConfig && i.def.needsConfig !== "apify_actors" && <p className="mt-1 text-xs"><Link className="underline" href="/settings">Settings &gt; Job discovery</Link> holds the list of {i.def.needsConfig === "greenhouse_boards" ? "boards" : "companies"}.</p>}</div>
                <div><div className="mb-1 font-medium">Limits</div><ul className="list-disc pl-5 text-muted-foreground">{i.def.limitations.map((l) => <li key={l}>{l}</li>)}</ul></div>
              </div>
              {i.def.id === "apify" && <ApifyActors actors={apify.actors} />}
              {i.def.available && i.def.id !== "manual" && (
                <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-xs">
                  <div>Last scan: {when(i.state?.last_scan_at)} · Last success: {when(i.state?.last_ok_at)} · Jobs found in total: {i.state?.jobs_found_total ?? 0}</div>
                  {i.state?.last_test_at && <div>Last test ({when(i.state.last_test_at)}): <span className={i.state.last_test_ok ? "" : "text-destructive"}>{i.state.last_test_message}</span></div>}
                  {i.state?.last_error && <div className="text-destructive">Last error ({when(i.state.last_error_at)}): {i.state.last_error}</div>}
                </div>
              )}
              {i.recentScans.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium">Recent scans ({i.recentScans.length})</summary>
                  <Table>
                    <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Query</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {i.recentScans.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs">{when(s.started_at)}</TableCell>
                          <TableCell className="text-xs">{s.query ?? "-"} {s.country && <Badge variant="outline">{s.country.toUpperCase()}</Badge>}</TableCell>
                          <TableCell className="whitespace-normal text-xs">{s.status === "error" ? <span className="text-destructive">{s.error}</span> : `${s.fetched} fetched, ${s.inserted} new, ${s.duplicates} already known`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
