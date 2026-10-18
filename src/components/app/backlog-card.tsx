import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { backlogCounts } from "@/lib/backlog";
import { hoursToClear } from "@/lib/backlog-rules";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { ago } from "@/lib/automation-checks";

/** What is waiting, and the plain answer to "why is it not clearing": the hourly check works through it by itself. */
export async function BacklogCard() {
  const [c, ap, st] = await Promise.all([backlogCounts().catch(() => null), getSetting("auto_prepare"), db().from("settings").select("value").eq("key", "drain_state").maybeSingle()]);
  if (!c) return null;
  const last = st.data?.value as { at?: string; noProgress?: number; last?: { scored: number; prepared: number } } | undefined;
  const hours = hoursToClear(c.unscored, ap.enabled ? c.unprepared : 0, ap.per_run);
  const clear = c.unscored === 0 && (!ap.enabled || c.unprepared === 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Waiting to be processed</CardTitle></CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <div><b>{c.unscored}</b> found job{c.unscored === 1 ? "" : "s"} waiting to be <Link className="underline" href="/jobs?view=new">scored</Link> · <b>{c.unprepared}</b> good match{c.unprepared === 1 ? "" : "es"} waiting for a resume to be prepared{ap.enabled ? "" : " (automatic preparing is off)"}.</div>
        <div className="text-muted-foreground">
          {clear ? "Nothing is backed up." : `You do not need to press anything: the app scores a batch (about 60 jobs) and prepares ${ap.enabled ? `up to ${ap.per_run} resumes` : "no resumes"} round after round (a new round starts as soon as the last one ends) until the list is empty. At that pace this clears in about ${hours} hour${hours === 1 ? "" : "s"}.`}
          {last?.at ? ` Last backlog round ${ago(last.at, new Date())}: ${last.last?.scored ?? 0} scored, ${last.last?.prepared ?? 0} prepared.` : ""}
          {last && (last.noProgress ?? 0) >= 2 ? " The last rounds made no progress (check AI models), so it is pausing for a few hours." : ""}
        </div>
      </CardContent>
    </Card>
  );
}
