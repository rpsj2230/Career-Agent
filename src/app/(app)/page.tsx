import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { AutomationBanner } from "@/components/app/automation-banner";
import { BackgroundBanner } from "@/components/app/background-banner";
import { PipelineStrip } from "@/components/app/pipeline-strip";
import { StatusBadge } from "@/components/app/badges";
import { ConnectionBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadDashboard } from "@/lib/dashboard-store";
import { loadApplyStats } from "@/lib/apply/stats-store";
import { assistantPanelData, assistantStatus } from "@/lib/apply/assistant-health";
import { AssistantPanel } from "@/components/app/assistant-panel";
import { parsePeriod, PERIODS, type Breakdown } from "@/lib/dashboard";
import { db, must } from "@/lib/db";
import { countryLabel, parseCountry } from "@/lib/filters";
import { storedKeyLabels } from "@/lib/llm/keys";
import { loadPortalsView } from "@/lib/integrations/view";
import { portalLabel } from "@/lib/jobs/portal";
import { getProfile } from "@/lib/profile/store";
import { filterOptions } from "@/lib/queries";
import { getSetting } from "@/lib/settings";
import { fmtDateTime, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";
const select = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const country = parseCountry(sp);
  const period = parsePeriod(Array.isArray(sp.period) ? sp.period[0] : sp.period);
  const [dash, portals, profile, discovery, opts, applyStats, assistant, panel] = await Promise.all([loadDashboard({ period, country }), loadPortalsView(), getProfile(), getSetting("discovery"), filterOptions(), loadApplyStats(30).catch(() => []), assistantStatus().catch(() => null), assistantPanelData().catch(() => null)]);
  const { summary: s, runs, limited } = dash;
  const models = must<{ label: string; enabled: boolean; api_key_env: string | null }[]>(await db().from("model_configs").select("label,enabled,api_key_env"), "models");
  const stored = await storedKeyLabels();

  const steps = [
    { done: profile.experience.length > 0, label: "Import and confirm your profile", href: "/profile" },
    { done: models.some((m) => m.enabled && (m.api_key_env === null || stored.has(m.label) || !!process.env[m.api_key_env])), label: "Add at least one model API key (free tiers work)", href: "/models" },
    { done: (discovery.roles.length || profile.preferences.roles.length) > 0, label: "Set the roles and countries to search", href: "/countries" },
  ];
  const ready = steps.every((x) => x.done);
  const q = (path: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...extra, ...(country ? { country } : {}) });
    return p.size ? `${path}?${p}` : path;
  };
  const tile = (label: string, value: number | string, href: string, hint?: string, tone?: "bad" | "warn") => (
    <Link key={label} href={href} className="group">
      <Card className={`h-full transition-colors group-hover:bg-muted/50 ${tone === "bad" && Number(value) > 0 ? "border-destructive" : tone === "warn" && Number(value) > 0 ? "border-amber-500" : ""}`}>
        <CardHeader className="pb-1"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader>
        {hint && <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>}
      </Card>
    </Link>
  );
  const maxFunnel = Math.max(1, ...s.funnel.map((f) => f.n));
  const recent = must<{ id: string; status: string; created_at: string; job: { title: string; company: string } | null }[]>(
    await (country
      ? db().from("applications").select("id,status,created_at, job:jobs!inner(title,company)").eq("job.country", country)
      : db().from("applications").select("id,status,created_at, job:jobs(title,company)")
    ).order("created_at", { ascending: false }).limit(6), "recent",
  );

  const breakdown = (title: string, rows: Breakdown[], label: (k: string) => string, hrefFor: (k: string) => string) => (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this period.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead /><TableHead className="text-right">Found</TableHead><TableHead className="text-right">Matched</TableHead><TableHead className="text-right">Prepared</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Fail</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r) => (
              <TableRow key={r.key}><TableCell><Link className="underline" href={hrefFor(r.key)}>{label(r.key)}</Link></TableCell>
                <TableCell className="text-right">{r.found}</TableCell><TableCell className="text-right">{r.matched}</TableCell><TableCell className="text-right">{r.prepared}</TableCell><TableCell className="text-right">{r.submitted}</TableCell><TableCell className="text-right">{r.failed}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {ready && (
          <div className="flex gap-2">
            <ActionButton method="POST" endpoint="/api/run/discover" success="Started">Search job sites now</ActionButton>
            <ActionButton variant="outline" method="POST" endpoint="/api/run/score" success="Started">Score unscored jobs</ActionButton>
          </div>
        )}
      </div>

      <BackgroundBanner />
      <AutomationBanner />
      <PipelineStrip />

      {!ready && (
        <Card className="border-amber-500">
          <CardHeader><CardTitle>Finish setup</CardTitle><CardDescription>The agent needs these before it can work.</CardDescription></CardHeader>
          <CardContent><ol className="grid gap-2 text-sm">
            {steps.map((x, i) => (
              <li key={i} className="flex items-center gap-2"><Badge variant={x.done ? "default" : "outline"}>{x.done ? "done" : "todo"}</Badge>{x.done ? x.label : <Link href={x.href} className="underline">{x.label}</Link>}</li>
            ))}
          </ol></CardContent>
        </Card>
      )}

      <form method="get" action="/" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">Period
          <select name="period" defaultValue={period} className={select}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Country
          <select name="country" defaultValue={country ?? ""} className={select}><option value="">All countries</option>{opts.countries.map((c) => <option key={c.key} value={c.key}>{countryLabel(c.key)}{c.n ? ` (${c.n})` : ""}</option>)}</select></label>
        <Button type="submit" size="sm">Apply</Button>
        <Button asChild type="button" size="sm" variant="ghost"><Link href="/">Clear</Link></Button>
      </form>
      <p className="text-sm text-muted-foreground">{PERIODS[period]}{country ? ` · ${countryLabel(country)} only` : ""} · since {fmtDateTime(dash.from)}.{limited && " Some figures are unavailable until the database update is applied (see System)."}</p>

      <section aria-label="Connected portals" className="grid gap-2">
        <h2 className="text-lg font-semibold">Portals and sources</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {portals.integrations.filter((i) => i.def.available && i.def.discovers).map((i) => (
            <Link key={i.def.id} href="/portals" className="rounded-md border p-3 text-sm hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.def.name}</span><ConnectionBadge status={i.status} /></div>
              <div className="mt-1 text-xs text-muted-foreground">{i.state?.last_scan_at ? `Last scan ${fmtDateTime(i.state.last_scan_at)}` : "Never scanned"}</div>
              {i.state?.last_error && i.status === "error" && <div className="mt-1 line-clamp-2 text-xs text-destructive">{i.state.last_error}</div>}
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Activity in the period" className="grid gap-2">
        <h2 className="text-lg font-semibold">What happened</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {tile("Scans run", s.period.scans, "/logs/runs", `${s.period.jobsFetched} listings fetched`)}
          {tile("New jobs found", s.period.found, q("/jobs", { view: "all" }), `${s.period.duplicates} duplicates skipped`)}
          {tile("Matched", s.period.matched, q("/jobs", { view: "queue" }), "scored above your threshold")}
          {tile("Rejected", s.period.rejected, q("/jobs", { view: "skipped" }), "with reasons")}
          {tile("Documents made", s.period.documents, q("/logs", { category: "resume" }), "resumes and cover letters")}
          {tile("Prepared", s.period.prepared, q("/applications"), "applications built")}
          {tile("Submitted", s.period.submitted, q("/applications", { status: "submitted" }), `${s.period.submittedAuto} automatic · ${s.period.submittedManual} by you`)}
        </div>
      </section>

      <section aria-label="Needs attention" className="grid gap-2">
        <h2 className="text-lg font-semibold">Right now</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tile("Pending approval", s.now.awaiting, q("/applications", { status: "pending" }), "waiting for you", "warn")}
          {tile("Requires manual action", s.now.manual, q("/applications", { status: "manual" }), "you press the final submit", "warn")}
          {tile("In progress", s.now.inProgress, q("/applications", { status: "inprogress" }), "approved or submitting")}
          {tile("Failed", s.now.failed, q("/applications", { status: "failed" }), "see reasons below", "bad")}
        </div>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base">Funnel</CardTitle><CardDescription>From listings found to applications sent, in this period.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {s.funnel.map((f) => (
            <div key={f.key} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-sm">
              <span>{f.label}</span>
              <div className="h-5 rounded bg-muted" role="img" aria-label={`${f.label}: ${f.n}`}><div className="h-5 rounded bg-primary" style={{ width: `${Math.max(f.n ? 2 : 0, Math.round((f.n / maxFunnel) * 100))}%` }} /></div>
              <span className="text-right font-medium">{f.n}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {breakdown("By country", s.byCountry, (k) => (k === "unknown" ? "Unknown" : countryLabel(k)), (k) => `/jobs?view=all&country=${k}`)}
        {breakdown("By portal", s.byPortal, (k) => (k === "unknown" ? "Unknown" : portalLabel(k)), (k) => q("/jobs", { view: "all", portal: k }))}
      </div>

      <Card className={s.problems.length ? "border-destructive" : ""}>
        <CardHeader><CardTitle className="text-base">Failures and what needs you</CardTitle><CardDescription>{s.problems.length ? "Each item says why it did not go through." : "Nothing failed in this period."}</CardDescription></CardHeader>
        {s.problems.length > 0 && (
          <CardContent><ul className="grid gap-2 text-sm">
            {s.problems.map((p, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <Badge variant={p.kind === "application" ? "outline" : "destructive"}>{p.kind}</Badge>
                <Link className="font-medium underline" href={p.kind === "application" ? `/applications/${p.id}` : p.kind === "run" ? `/logs/runs/${p.id}` : "/portals"}>{p.title}</Link>
                <span className="text-muted-foreground">{p.reason}</span>
              </li>
            ))}
          </ul></CardContent>
        )}
      </Card>

      {panel && <AssistantPanel {...panel} />}

      {(applyStats.length > 0 || assistant) && (
        <Card>
          <CardHeader><CardTitle className="text-base">How applying is going (last 30 days)</CardTitle><CardDescription>Where applications were sent, how many went through, and the most common reasons the rest stopped. {assistant ? assistant.text : ""}</CardDescription></CardHeader>
          {applyStats.length > 0 && (
            <CardContent className="grid gap-2 text-sm">
              {applyStats.map((c) => (
                <div key={c.channel} className="grid gap-0.5 rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><b>{c.label}</b><span>{c.submitted} of {c.attempts} submitted ({c.rate}%){c.needsYou ? ` · ${c.needsYou} needed you` : ""}{c.failed ? ` · ${c.failed} failed` : ""}</span></div>
                  {c.topReasons.length > 0 && <div className="text-xs text-muted-foreground">Most common stops: {c.topReasons.map((r) => `${r.reason} (${r.count})`).join("; ")}</div>}
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent applications</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {recent.length === 0 ? <p className="text-muted-foreground">None yet.</p> : recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <Link href={`/applications/${r.id}`} className="hover:underline"><span className="font-medium">{r.job?.title}</span> <span className="text-muted-foreground">{r.job?.company}</span></Link>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Latest runs</CardTitle><CardDescription><Link className="underline" href="/logs/runs">All runs</Link> · <Link className="underline" href="/schedules">Schedules</Link></CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {runs.length === 0 ? <p className="text-muted-foreground">Nothing has run yet.</p> : runs.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <Link href={`/logs/runs/${r.id}`} className="hover:underline">{r.kind} · {fmtDateTime(r.started_at)}{fmtDuration(r.started_at, r.finished_at) ? ` · ${fmtDuration(r.started_at, r.finished_at)}` : ""}</Link>
                <Badge variant={r.status === "failed" ? "destructive" : r.status === "succeeded" ? "default" : "outline"}>{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
