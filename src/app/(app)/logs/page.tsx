import Link from "next/link";
import { LogTable } from "@/components/app/log-table";
import { PageSizeBar, Pagination } from "@/components/app/pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LOG_CATEGORIES, LOG_KINDS } from "@/lib/activity-types";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { activeFilterLabels, LOG_LEVELS, LOG_STATUSES, logHref, PAGE_SIZE, parseLogFilters, presetRange } from "@/lib/log-filters";
import { queryLogs } from "@/lib/log-queries";
import { filterOptions } from "@/lib/queries";
import { appTimezone } from "@/lib/time";

export const dynamic = "force-dynamic";

const sel = "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = parseLogFilters(sp);
  const tz = appTimezone();
  const [{ rows, total, missing }, opts] = await Promise.all([queryLogs(f, tz), filterOptions()]);
  const pages = Math.max(1, Math.ceil(total / f.size));
  const chips = activeFilterLabels(f);
  const today = presetRange("today", tz), week = presetRange("7d", tz), month = presetRange("30d", tz);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Activity log</h1>
          <p className="text-sm text-muted-foreground">Everything the system did: scans, matches and rejections with reasons, documents, applications, runs, errors and configuration changes. Times are in {tz}.</p>
        </div>
        <Button variant="outline" asChild><Link href="/logs/runs">Runs and scans</Link></Button>
      </div>

      {missing && (
        <Alert variant="destructive"><AlertTitle>Database update needed</AlertTitle><AlertDescription>The activity log cannot be read until the update is applied. <Link className="underline" href="/system">Open System</Link>.</AlertDescription></Alert>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="self-center text-muted-foreground">Quick range:</span>
        <Button asChild size="sm" variant="outline"><Link href={logHref({ ...f, ...today, page: 1 })}>Today</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href={logHref({ ...f, ...week, page: 1 })}>Last 7 days</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href={logHref({ ...f, ...month, page: 1 })}>Last 30 days</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link href={logHref({ ...f, from: undefined, to: undefined, page: 1 })}>All time</Link></Button>
      </div>

      <form method="get" action="/logs" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">From<Input type="date" name="from" defaultValue={f.from ?? ""} className="h-9" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">To<Input type="date" name="to" defaultValue={f.to ?? ""} className="h-9" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Level
          <select name="level" defaultValue={f.level ?? ""} className={sel}><option value="">Any</option>{LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Type
          <select name="category" defaultValue={f.category ?? ""} className={sel}><option value="">Any</option>{LOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Event
          <select name="kind" defaultValue={f.kind ?? ""} className={sel}><option value="">Any</option>{LOG_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Portal
          <select name="portal" defaultValue={f.portal ?? ""} className={sel}><option value="">All portals</option>{opts.portals.map((p) => <option key={p.key} value={p.key}>{portalLabel(p.key)}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Country
          <select name="country" defaultValue={f.country ?? ""} className={sel}><option value="">All countries</option>{opts.countries.map((c) => <option key={c.key} value={c.key}>{countryLabel(c.key)}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Company<Input name="company" defaultValue={f.company ?? ""} placeholder="contains" className="h-9 w-36" /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Status
          <select name="status" defaultValue={f.status ?? ""} className={sel}><option value="">Any</option>{LOG_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Text<Input name="q" defaultValue={f.q ?? ""} placeholder="in the message" className="h-9 w-40" /></label>
        {f.run && <input type="hidden" name="run" value={f.run} />}
        {f.app && <input type="hidden" name="app" value={f.app} />}
        {f.job && <input type="hidden" name="job" value={f.job} />}
        <Button type="submit" size="sm">Apply filters</Button>
        <Button asChild size="sm" variant="ghost"><Link href="/logs">Clear</Link></Button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">Filtering by:</span>
          {chips.map((c) => <Link key={c.key} href={logHref({ ...f, [c.key]: undefined, page: 1 })}><Badge variant="secondary">{c.label} ✕</Badge></Link>)}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{total} event{total === 1 ? "" : "s"}{pages > 1 ? ` · page ${f.page} of ${pages}` : ""}</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <PageSizeBar basePath="/logs" sp={sp} size={f.size} defaultSize={PAGE_SIZE} total={total} shownFrom={total === 0 ? 0 : (f.page - 1) * f.size + 1} shownTo={Math.min(total, f.page * f.size)} />
          <LogTable rows={rows} />
          <Pagination basePath="/logs" sp={sp} page={Math.min(f.page, pages)} pages={pages} size={f.size} defaultSize={PAGE_SIZE} />
        </CardContent>
      </Card>
    </div>
  );
}
