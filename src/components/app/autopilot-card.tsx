import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTOPILOT } from "@/lib/autopilot";
import { getSetting } from "@/lib/settings";
import { ActionButton } from "./action-button";

/** The one switch for running without a person: finds, scores, writes, approves and sends on its own, every hour, until nothing is left. */
export async function AutopilotCard() {
  const ap = await getSetting("autopilot").catch(() => ({ enabled: false, since: "" }));
  const c = AUTOPILOT.caps;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">Autopilot <Badge className={ap.enabled ? "bg-green-600 text-white" : ""} variant={ap.enabled ? "default" : "secondary"}>{ap.enabled ? "on" : "off"}</Badge></CardTitle>
        <CardDescription>
          {ap.enabled
            ? `Running by itself. Every hour the app scores new jobs, writes resumes, approves everything that is ready (including what was already waiting) and queues it for sending. Sending is limited to ${c.daily_total} a day (LinkedIn ${c.daily_linkedin} a day, ${c.weekly_linkedin} a week) and starts again each day until nothing is left.`
            : `One switch for everything: Auto-Apply on, schedules set to search every ${AUTOPILOT.schedule.interval_hours} hours and apply without asking, up to ${AUTOPILOT.autoPrepare.per_run} resumes per round, ${c.daily_total} applications a day, the assistant allowed to press Submit, and every prepared application approved by the hourly round.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {ap.enabled
          ? <ActionButton variant="outline" endpoint="/api/autopilot" body={{ enabled: false }} success="Autopilot is off" confirm="Turn Autopilot off? Schedules will ask for your approval again.">Turn Autopilot off</ActionButton>
          : <ActionButton endpoint="/api/autopilot" body={{ enabled: true }} success="Autopilot is on" confirm={`Turn Autopilot on? From now on applications are approved and sent without asking you, up to ${c.daily_total} a day. LinkedIn restricts accounts that apply in bulk, so its limit is ${c.daily_linkedin} a day.`}>Turn Autopilot on</ActionButton>}
        <span className="text-xs text-muted-foreground">Your computer is needed only for LinkedIn, Indeed and Naukri, which need your sign-in (<code>npm run assist:check</code>). Greenhouse, Lever, Ashby, Workable and employers\u2019 own pages (no sign-in needed) are sent from the cloud (GitHub, and an always-on machine if you set one up), even with your computer off. Your computer takes over any that wait more than 90 minutes.</span>
      </CardContent>
    </Card>
  );
}
