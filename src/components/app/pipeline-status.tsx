import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Cause, Stage } from "@/lib/pipeline-status";
import { loadPipelineStatus } from "@/lib/pipeline-status-store";

const CAUSE: Record<Cause, { label: string; cls: string }> = {
  model: { label: "AI model", cls: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  server: { label: "Server / runner", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" },
  setting: { label: "Setting", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  limit: { label: "Limit reached", cls: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" },
  you: { label: "Waiting for you", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  normal: { label: "Normal", cls: "bg-muted text-muted-foreground" },
};
const STATE: Record<Stage["state"], { label: string; cls: string }> = {
  clear: { label: "Clear", cls: "bg-green-600 text-white" },
  flowing: { label: "Flowing", cls: "bg-green-600 text-white" },
  blocked: { label: "Blocked", cls: "bg-amber-500 text-white" },
  you: { label: "Needs you", cls: "bg-sky-600 text-white" },
};

/** How much of each step is done, how much is waiting, and the plain reason why, with the fix. */
export async function PipelineStatus() {
  const s = await loadPipelineStatus().catch(() => null);
  if (!s) return null;
  return (
    <Card id="pipeline-status">
      <CardHeader>
        <CardTitle>Where everything stands</CardTitle>
        <CardDescription>{s.headline} Each step shows how much is done and, if anything waits, the reason: the AI model, the server or runner, a setting, a limit, or you.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {s.stages.map((g) => (
          <div key={g.id} className="grid gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={g.href} className="font-medium hover:underline">{g.title}</Link>
              <Badge className={STATE[g.state].cls}>{STATE[g.state].label}</Badge>
              <span className="text-xs text-muted-foreground">{g.question}</span>
              <span className="ml-auto text-sm"><b>{g.waiting.toLocaleString("en-US")}</b> waiting{g.pct !== null ? <> · <b>{g.pct}%</b> done ({g.done.toLocaleString("en-US")} of {(g.done + g.waiting).toLocaleString("en-US")})</> : null}</span>
            </div>
            {g.pct !== null && (
              <div className="h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={g.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.title} ${g.pct}% done`}>
                <div className="h-full bg-green-600" style={{ width: `${g.pct}%` }} />
              </div>
            )}
            {g.reasons.length > 0 && (
              <ul className="grid gap-1.5 text-sm">
                {g.reasons.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${CAUSE[r.cause].cls}`}>{CAUSE[r.cause].label}</span>
                    <span className="min-w-0 flex-1">{r.text}{r.fix ? <> <span className="text-muted-foreground">{r.fix}</span></> : null}{r.href ? <> <Link href={r.href} className="underline">Open</Link></> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
