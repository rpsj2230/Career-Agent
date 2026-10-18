import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { loadPortalsView } from "@/lib/integrations/view";
import { describeSource, lastBatch, type SourceLine } from "@/lib/search-summary";

const TONE: Record<SourceLine["tone"], string> = { ok: "bg-green-600 text-white", quiet: "", problem: "bg-red-600 text-white", off: "" };

/** What the last search did, source by source, so "only one source worked" always comes with the reason for each of the others. */
export async function SearchSummary() {
  const view = await loadPortalsView().catch(() => null);
  if (!view) return null;
  const lines = view.integrations.filter((i) => i.def.discovers).map((i) => {
    const b = lastBatch(i.recentScans);
    return describeSource({ id: i.def.id, name: i.def.name, status: i.status, needsConfig: !!i.def.needsConfig, lastScanAt: b.at, scans: b.scans, fetched: b.fetched, inserted: b.inserted, error: b.error });
  });
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">What the last search did, source by source <span className="text-muted-foreground">({lines.filter((l) => l.tone === "ok").length} of {lines.length} found new jobs)</span></summary>
      <Card className="border-0 shadow-none">
        <CardHeader className="pt-0"><CardDescription>Each job source is asked for your roles in your countries. Sources that are not connected, or that only cover some countries, simply return nothing. <Link className="underline" href="/portals">Connect more sources</Link>.</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {lines.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm">
              <Badge variant={l.tone === "quiet" || l.tone === "off" ? "secondary" : "default"} className={TONE[l.tone]}>{l.headline}</Badge>
              <div><b>{l.name}</b><div className="text-xs text-muted-foreground">{l.detail}</div></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </details>
  );
}
