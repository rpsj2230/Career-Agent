import Link from "next/link";
import { CreateRecommendedSchedule, ScheduleCard, ScheduleForm } from "@/components/app/schedule-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEffectiveCountries } from "@/lib/country-config-store";
import { countryLabel } from "@/lib/filters";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { BLANK_SCHEDULE, describeSchedule } from "@/lib/schedule";
import { listSchedules } from "@/lib/schedule-store";
import { appTimezone, fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const ZONES = ["Asia/Kolkata", "Asia/Singapore", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];

export default async function SchedulesPage() {
  const [{ rows, missing }, { countries }] = await Promise.all([listSchedules(), loadEffectiveCountries()]);
  const tz = appTimezone();
  const countryOpts = countries.filter((c) => !c.fallback).map((c) => ({ key: c.country, label: countryLabel(c.country) }));
  const integrationOpts = INTEGRATIONS.filter((i) => i.available && i.discovers).map((i) => ({ key: i.id, label: i.name }));
  const zones = [...new Set([tz, ...ZONES])];
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <p className="text-sm text-muted-foreground">Run searches, matching and application preparation automatically. Times are in each schedule&apos;s own time zone; the app shows times in {tz}. A run that was missed (for example while paused) is not replayed. Schedules never submit by themselves unless Auto-Apply is switched on in Settings.</p>
      </div>
      {missing && <Alert variant="destructive"><AlertTitle>Database update needed</AlertTitle><AlertDescription>Schedules cannot be saved until the update is applied. <Link className="underline" href="/system">Open System</Link>.</AlertDescription></Alert>}
      {rows.length === 0 && !missing && <Alert><AlertTitle>No schedules yet</AlertTitle><AlertDescription>Nothing runs on its own until you create one. The recommended schedule runs every day at 09:00 ({tz}), finds and scores jobs in your countries, prepares up to 20 applications and waits for your approval before anything is sent. You can change everything afterwards.</AlertDescription><div className="mt-3"><CreateRecommendedSchedule timezone={tz} /></div></Alert>}
      <div className="grid gap-4">
        {rows.map((r) => (
          <ScheduleCard key={r.id} countries={countryOpts} integrations={integrationOpts} zones={zones}
            v={{ ...r, describe: describeSchedule(r), nextRun: fmtDateTime(r.next_run_at), lastRun: fmtDateTime(r.last_run_at, tz, "never"), lastStatus: r.last_run_status }} />
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>New schedule</CardTitle></CardHeader>
        <CardContent><ScheduleForm initial={{ ...BLANK_SCHEDULE, timezone: tz }} countries={countryOpts} integrations={integrationOpts} zones={zones} /></CardContent>
      </Card>
    </div>
  );
}
