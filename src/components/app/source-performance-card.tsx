import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { sourceVerdict, summarizeScans } from "@/lib/source-performance";

const TONE = { good: "bg-green-600 text-white", ok: "", bad: "bg-red-600 text-white", early: "" } as const;

/** Which job sources are worth keeping: the last 30 days of searches and what came of them. */
async function load() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return Promise.all([
    db().from("portal_scans").select("integration,status,fetched,inserted,started_at").gte("started_at", since).limit(20000),
    db().from("jobs").select("source,status").gte("found_at", since).limit(20000),
  ]);
}

export async function SourcePerformanceCard() {
  const [scans, jobs] = await load();
  if (scans.error || jobs.error) return null;
  const names = Object.fromEntries(INTEGRATIONS.map((i) => [i.id, i.name]));
  const rows = summarizeScans(scans.data as never, jobs.data as never, names).filter((r) => r.scans > 0 || r.inserted > 0);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Which job sources are worth it? (last 30 days)</CardTitle>
        <CardDescription>For each source: searches made, postings read, new jobs found, and how many of them became good matches. After about a month of runs the verdict becomes reliable and tells you which sources to keep, fix or switch off.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Source</th><th className="pr-3">Searches</th><th className="pr-3">Failed</th><th className="pr-3">Read</th><th className="pr-3">New jobs</th><th className="pr-3">Good matches</th><th>Verdict</th></tr></thead>
          <tbody>
            {rows.map((r) => { const v = sourceVerdict(r); return (
              <tr key={r.id} className="border-t align-top">
                <td className="py-2 pr-3 font-medium">{r.name}</td><td className="pr-3">{r.scans}</td><td className="pr-3">{r.failedScans}</td><td className="pr-3">{r.fetched}</td><td className="pr-3">{r.inserted}</td><td className="pr-3">{r.matched}</td>
                <td className="max-w-md py-2"><Badge className={TONE[v.tone]} variant={TONE[v.tone] ? "default" : "outline"}>{v.headline}</Badge><div className="mt-1 text-xs text-muted-foreground">{v.advice}</div></td>
              </tr>); })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
