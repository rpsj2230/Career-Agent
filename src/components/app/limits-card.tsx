import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { backlogCounts } from "@/lib/backlog";
import { last24h } from "@/lib/limits-store";
import { limitsOverview } from "@/lib/limits-overview";
import { describeSchedule } from "@/lib/schedule";
import { listSchedules } from "@/lib/schedule-store";
import { getSetting } from "@/lib/settings";

/** All the numbers that decide how much is written and sent, in one place, with what really happened in the last 24 hours. */
export async function LimitsCard() {
  const [{ rows: schedules }, autoPrepare, caps, autoapply, scoring, discovery, backlog] = await Promise.all([
    listSchedules().catch(() => ({ rows: [], missing: false })), getSetting("auto_prepare"), getSetting("caps"), getSetting("autoapply"),
    getSetting("scoring"), getSetting("discovery"), backlogCounts().catch(() => ({ unscored: 0, unprepared: 0 })),
  ]);
  const done = await last24h(scoring.threshold ?? 65);
  const rows = limitsOverview({
    autoPrepare: { enabled: !!autoPrepare.enabled, per_run: autoPrepare.per_run ?? 0, concurrency: autoPrepare.concurrency ?? 3 },
    schedules: schedules.map((s) => ({ name: s.name, describe: describeSchedule(s), mode: s.mode, max_prepare: s.max_prepare, max_apply: s.max_apply, require_approval: s.require_approval, enabled: s.enabled, paused: s.paused })),
    caps: { daily_total: caps.daily_total ?? 15, daily_linkedin: caps.daily_linkedin ?? 10, weekly_linkedin: caps.weekly_linkedin ?? 40, local_auto_enabled: !!caps.local_auto_enabled, company_cooldown_days: caps.company_cooldown_days ?? 14 },
    autoApplyOn: !!autoapply.enabled, last24h: done, waitingForResume: backlog.unprepared, waitingForScore: backlog.unscored,
    discovery: { max_age_days: discovery.max_age_days ?? 30, min_rescan_hours: discovery.min_rescan_hours ?? 6 }, scoring: { threshold: scoring.threshold ?? 65, min_evidence: scoring.min_evidence ?? 20 },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What happens on every run: the limit at each step, in one place</CardTitle>
        <CardDescription>
          <b>When it runs:</b> the app checks every hour. A schedule runs every N hours (Autopilot: every 6) and does all five steps; between schedules each hourly check works through the backlog (scores up to about 480 jobs, writes the resumes below, and with Autopilot approves up to 150 waiting applications). The assistant on your computer works through its queue non-stop: 40 at a time, with a new round a minute after any round that sent something. <b>Per run</b> means per schedule run or hourly round; <b>per day</b> is the sending limit, which starts again every day, so a backlog clears over the days it needs, not in one run.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {(["Find", "Score", "Match", "Resumes", "Sending"] as const).map((g) => (
          <div key={g}>
            <h3 className="mb-1 font-medium">{({ Find: "1. Find jobs (scan)", Score: "2. Score", Match: "3. Match", Resumes: "4. Write resumes and cover letters", Sending: "5. Approve and send" })[g]}</h3>
            <ul className="grid gap-1.5">
              {rows.filter((r) => r.group === g).map((r, k) => (
                <li key={k} className="flex flex-wrap gap-x-2"><b>{r.what}:</b><span className="min-w-0 flex-1 text-muted-foreground">{r.limit}{r.now ? <> <b className="text-foreground">Now: {r.now}</b></> : null} <Link className="underline" href={r.where.href}>{r.where.label}</Link></span></li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
