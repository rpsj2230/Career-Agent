import Link from "next/link";
import { notFound } from "next/navigation";
import { LogTable } from "@/components/app/log-table";
import { ApplyReportCard } from "@/components/app/apply-report-card";
import { runName, STATUS_STYLE } from "@/components/app/runs-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryLabel } from "@/lib/filters";
import { portalLabel } from "@/lib/jobs/portal";
import { parseLogFilters } from "@/lib/log-filters";
import { applyLogs, getRun, queryLogs } from "@/lib/log-queries";
import { runApplications, runJobs, runModels, runProblems } from "@/lib/run-queries";
import { applyReport, bySource, windowLabel } from "@/lib/run-report";
import { duration, leftReasons, runCounts, stepRows, taskLabel } from "@/lib/run-view";
import { getSetting } from "@/lib/settings";
import { appTimezone, fmtDateTime, fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

const TONE = { ok: "text-green-700 dark:text-green-400", warn: "text-amber-700 dark:text-amber-400", none: "text-muted-foreground" } as const;
const TRIGGER: Record<string, string> = { schedule: "started by its schedule", manual: "started by you (Run now)", api: "started by the app", worker: "started by a worker" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { run, scans } = await getRun(id);
  if (!run) notFound();
  const tz = appTimezone();
  const [{ rows: logRows }, scoring, models, jobs, apps, problems, applyRows] = await Promise.all([
    queryLogs({ ...parseLogFilters({ run: id }), page: 1 }), getSetting("scoring"), runModels(run), runJobs(id), runApplications(id), runProblems(id), applyLogs({ run: id }),
  ]);
  const sources = bySource(scans, portalLabel, tz);
  const applying = applyReport(applyRows, portalLabel, countryLabel);
  const scope = run.scope as { mode?: string; countries?: string[]; integrations?: string[] };
  const steps = stepRows(run.stats, sources, { threshold: scoring.threshold ?? 65, mode: scope.mode });
  const counts = runCounts(run.stats);
  const why = leftReasons(run.stats);
  const found = scans.length ? { from: scans[0].started_at, to: scans.map((s) => s.finished_at ?? s.started_at).sort().at(-1)! } : null;
  const callTotals = models.reduce((a, m) => ({ calls: a.calls + m.calls, failed: a.failed + m.failed }), { calls: 0, failed: 0 });

  return (
    <div className="grid gap-4">
      <div>
        <Link href="/logs/runs" className="text-sm text-muted-foreground hover:underline">All runs</Link>
        <h1 className="text-2xl font-semibold">{runName(run)} <span className="font-mono text-base text-muted-foreground">{run.id.slice(0, 8)}</span></h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge className={STATUS_STYLE[run.status] ?? ""}>{run.status}</Badge>
          <span>Started {fmtDateTime(run.started_at)}</span>
          <span>· {run.finished_at ? `finished ${fmtDateTime(run.finished_at)} (took ${fmtDuration(run.started_at, run.finished_at)})` : "not finished"}</span>
          <span>· {TRIGGER[run.trigger] ?? run.trigger}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Scope: {scope.countries?.length ? scope.countries.map((c) => countryLabel(c)).join(", ") : "all countries"}; {scope.integrations?.length ? scope.integrations.map((i) => portalLabel(i)).join(", ") : "all connected sources"}.
          Times are in {tz}.
        </p>
      </div>

      {(run.error || problems.length > 0) && (
        <Card className="border-destructive">
          <CardHeader><CardTitle className="text-destructive">{run.status === "failed" ? "Why it failed" : "What went wrong"}</CardTitle><CardDescription>{problems.length} warning{problems.length === 1 ? "" : "s"} and error{problems.length === 1 ? "" : "s"} logged during this run.</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {run.error && <p className="whitespace-pre-wrap">{run.error}</p>}
            {problems.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Level</TableHead><TableHead>What</TableHead></TableRow></TableHeader>
                <TableBody>{problems.map((p) => <TableRow key={p.id}><TableCell className="whitespace-nowrap text-xs">{fmtDateTime(p.at)}</TableCell><TableCell><Badge variant={p.level === "error" ? "destructive" : "secondary"}>{p.level}</Badge></TableCell><TableCell className="whitespace-normal text-xs">{p.message}{p.company ? <span className="text-muted-foreground"> ({p.company})</span> : null}</TableCell></TableRow>)}</TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>What this run did, step by step</CardTitle><CardDescription>Only this run. The last-24-hours totals on the Schedules page add up every run together.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Result</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {steps.map((r) => (
                <TableRow key={r.step} className="align-top">
                  <TableCell className="whitespace-nowrap font-medium">{r.step}{r.step === "1. Find" && found ? <div className="text-xs font-normal text-muted-foreground">{fmtDateTime(found.from)} to {fmtDateTime(found.to)}</div> : null}</TableCell>
                  <TableCell className={`whitespace-nowrap font-semibold ${TONE[r.tone]}`}>{r.result}</TableCell>
                  <TableCell className="whitespace-normal text-sm text-muted-foreground">{r.detail}</TableCell>
                </TableRow>
              ))}
              <TableRow className="align-top">
                <TableCell className="whitespace-nowrap font-medium">6. Send</TableCell>
                <TableCell className="whitespace-nowrap font-semibold">{applying.submitted} sent so far</TableCell>
                <TableCell className="whitespace-normal text-sm text-muted-foreground">
                  Sending is done afterwards by the apply workers, within your daily limits, so this number keeps growing after the run ends.
                  {applying.needsYou ? ` ${applying.needsYou} handed back to you.` : ""}{applying.failed ? ` ${applying.failed} failed.` : ""}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {why.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Left for you ({counts.left}): {why.map((w) => `${w.count} because ${w.text}`).join("; ")}.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Where the jobs came from</CardTitle><CardDescription>One line per job source.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {sources.length === 0 ? <p className="text-sm text-muted-foreground">No search was run in this round.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Postings asked for</TableHead><TableHead className="text-right">Searches</TableHead><TableHead className="text-right">Postings returned</TableHead><TableHead className="text-right">New</TableHead><TableHead className="text-right">Already known</TableHead><TableHead className="text-right">Too old</TableHead></TableRow></TableHeader>
              <TableBody>{sources.map((s) => <TableRow key={s.source}><TableCell className="font-medium">{s.source}</TableCell><TableCell className="whitespace-nowrap text-xs">{s.window ?? "-"}</TableCell><TableCell className="text-right tabular-nums">{s.scans}{s.failed ? <span className="text-destructive"> ({s.failed} failed)</span> : null}</TableCell><TableCell className="text-right tabular-nums">{s.fetched}</TableCell><TableCell className="text-right tabular-nums">{s.inserted}</TableCell><TableCell className="text-right tabular-nums">{s.duplicates}</TableCell><TableCell className="text-right tabular-nums">{s.stale}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI models used</CardTitle>
          <CardDescription>{models.length === 0 ? "No AI call was made while this run was going." : `${callTotals.calls} call${callTotals.calls === 1 ? "" : "s"}, ${callTotals.failed} failed.`} Calls are matched to the run by time (from its start to its end), so another run working at the same moment would be included.</CardDescription>
        </CardHeader>
        {models.length > 0 && (
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Used for</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Failed</TableHead><TableHead className="text-right">Tokens in / out</TableHead><TableHead className="text-right">Average time</TableHead><TableHead>Last error</TableHead></TableRow></TableHeader>
              <TableBody>{models.map((m) => <TableRow key={`${m.model}/${m.task}`} className="align-top"><TableCell className="font-medium">{m.model}</TableCell><TableCell>{taskLabel(m.task)}</TableCell><TableCell className="text-right tabular-nums">{m.calls}</TableCell><TableCell className={`text-right tabular-nums ${m.failed ? "text-destructive" : ""}`}>{m.failed}</TableCell><TableCell className="text-right tabular-nums">{m.inputTokens.toLocaleString("en-US")} / {m.outputTokens.toLocaleString("en-US")}</TableCell><TableCell className="text-right tabular-nums">{duration(m.avgMs)}</TableCell><TableCell className="max-w-xs whitespace-normal text-xs text-destructive">{m.lastError ? <span className="line-clamp-2">{m.lastError}</span> : ""}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Jobs found in this run ({jobs.total})</CardTitle><CardDescription>{jobs.total > jobs.rows.length ? `The newest ${jobs.rows.length} are shown. ` : ""}Score is out of 100; blank means not scored yet.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {jobs.rows.length === 0 ? <p className="text-sm text-muted-foreground">This run found no new jobs.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Company</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Now</TableHead></TableRow></TableHeader>
              <TableBody>{jobs.rows.map((j) => <TableRow key={j.id}><TableCell className="max-w-xs whitespace-normal"><Link className="underline" href={`/jobs/${j.id}`}>{j.title}</Link></TableCell><TableCell className="whitespace-normal">{j.company}</TableCell><TableCell>{portalLabel(j.portal ?? j.source ?? "")}</TableCell><TableCell>{j.country ? countryLabel(j.country) : "-"}</TableCell><TableCell className="text-right tabular-nums">{j.score ?? ""}</TableCell><TableCell><Badge variant="outline">{j.status}</Badge></TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Applications prepared in this run ({apps.total})</CardTitle><CardDescription>Where each one stands now.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {apps.rows.length === 0 ? <p className="text-sm text-muted-foreground">This run prepared no applications.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Company</TableHead><TableHead>Site</TableHead><TableHead>Prepared</TableHead><TableHead>Approved</TableHead><TableHead>Sent</TableHead><TableHead>Now</TableHead></TableRow></TableHeader>
              <TableBody>{apps.rows.map((a) => <TableRow key={a.id} className="align-top"><TableCell className="max-w-xs whitespace-normal"><Link className="underline" href={`/applications/${a.id}`}>{a.title}</Link></TableCell><TableCell className="whitespace-normal">{a.company}</TableCell><TableCell>{a.portal ? portalLabel(a.portal) : "-"}</TableCell><TableCell className="whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</TableCell><TableCell className="whitespace-nowrap text-xs">{a.approved_at ? fmtDateTime(a.approved_at) : "-"}</TableCell><TableCell className="whitespace-nowrap text-xs">{a.submitted_at ? fmtDateTime(a.submitted_at) : "-"}</TableCell><TableCell className="whitespace-normal"><Badge variant="outline">{a.status}</Badge>{a.error ? <div className="mt-1 max-w-xs text-xs text-destructive">{a.error}</div> : null}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ApplyReportCard report={applying} title="Applying decided in this run" description="Approvals and hand-backs this run made. Submissions finished later by the apply worker appear under Runs and scans for the period." />

      {scans.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Every search in this run</CardTitle><CardDescription>One row per job title, place and source.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Country</TableHead><TableHead>Query</TableHead><TableHead>Postings asked for</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.started_at)}</TableCell><TableCell>{portalLabel(s.integration)}</TableCell>
                    <TableCell>{s.country ? countryLabel(s.country) : "-"}</TableCell><TableCell>{s.query ?? "-"}</TableCell><TableCell className="whitespace-nowrap text-xs">{windowLabel(s.detail, tz) ?? "-"}</TableCell>
                    <TableCell className="whitespace-normal text-xs">{s.status === "error" ? <span className="text-destructive">{s.error}</span> : `${s.fetched} fetched, ${s.inserted} new, ${s.duplicates} already known, ${s.stale} too old, ${s.invalid} unusable`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Everything logged during this run</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <LogTable rows={logRows} showRun={false} />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">All raw counters recorded by this run</summary>
            <div className="mt-2 flex flex-wrap gap-2">{Object.keys(run.stats ?? {}).length === 0 ? "None recorded." : Object.entries(run.stats).map(([k, v]) => <Badge key={k} variant="secondary">{k}: {v}</Badge>)}</div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
