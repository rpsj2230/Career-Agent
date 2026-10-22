import { searchingCountries } from "@/lib/country-summary";
import { AutoApplyCard } from "@/components/app/autoapply-card";
import { DeliveryCard } from "@/components/app/delivery-card";
import { PauseCard } from "@/components/app/pause-card";
import { AutoPrepareCard } from "@/components/app/auto-prepare-card";
import { EmailApplyCard } from "@/components/app/email-apply-card";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { appTimezone } from "@/lib/time";
import { SettingsForm, type SettingsSectionId } from "@/components/app/settings-form";
import { getProfile } from "@/lib/profile/store";
import { dedupeList } from "@/lib/country-prefs";
import { getSetting } from "@/lib/settings";
import { TeamCard } from "@/components/app/team-card";
import { getOwnerEmail, getTeam } from "@/lib/owner";
import { listProfiles } from "@/lib/profiles-store";
import { listSchedules } from "@/lib/schedule-store";
import { pipelineTable } from "@/lib/pipeline-table";
import { SettingsSection } from "@/components/app/settings-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const searching = await searchingCountries();
  const [discovery, scoring, caps, tailoring, blocklist, replies, profile] = await Promise.all([getSetting("discovery"), getSetting("scoring"), getSetting("caps"), getSetting("tailoring"), getSetting("blocklist"), getSetting("replies"), getProfile()])
  const autoapply = await getSetting("autoapply");
  const delivery = await getSetting("delivery");
  const emailApply = await getSetting("email_apply");
  const autoPrepare = await getSetting("auto_prepare");
  const pause = await getSetting("automation_pause");
  const mailbox = (await resolveCredentials().catch(() => null))?.creds.mailbox?.user ?? null;;
  const roles = dedupeList([...profile.preferences.roles, ...discovery.roles]);
  const schedules = (await listSchedules().catch(() => ({ rows: [], missing: false }))).rows;
  const glance = pipelineTable({
    last24h: { found: null, scored: null, matched: null, prepared: null, approved: null, sent: null },
    waiting: { toScore: null, toPrepare: null, toApprove: null, toSend: null, needsYou: null },
    autoPrepare: { enabled: !!autoPrepare.enabled, per_run: autoPrepare.per_run ?? 0, concurrency: autoPrepare.concurrency ?? 3 },
    schedules: schedules.map((x) => ({ name: x.name, mode: x.mode, max_prepare: x.max_prepare, max_apply: x.max_apply, require_approval: x.require_approval, enabled: x.enabled, paused: x.paused })),
    caps: { daily_total: caps.daily_total ?? 15, daily_linkedin: caps.daily_linkedin ?? 10, weekly_linkedin: caps.weekly_linkedin ?? 40, local_auto_enabled: !!caps.local_auto_enabled, company_cooldown_days: caps.company_cooldown_days ?? 14 },
    autoApplyOn: !!autoapply.enabled, sentAutomaticallyToday: 0,
    discovery: { max_age_days: discovery.max_age_days ?? 30, min_rescan_hours: discovery.min_rescan_hours ?? 6 }, scoring: { threshold: scoring.threshold ?? 65 },
  });
  const form = (section: SettingsSectionId) => <SettingsForm section={section} searching={searching} discovery={discovery} scoring={scoring} caps={caps} tailoring={tailoring} blocklist={blocklist} replies={replies} roles={roles} />;
  const NAV = [["pause", "Pause"], ["find", "1 Find"], ["score-match", "2-3 Score and match"], ["prepare", "4 Prepare"], ["approve-send", "5-6 Approve and send"], ["after", "After applying"], ["access", "People"]] as const;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Everything here follows the order the agent works in: find jobs, score them, match, prepare the resume, approve, send. Each section says what it does and which limit applies.</p>
        <nav className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Settings sections">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-full border px-3 py-1 hover:bg-muted">{label}</a>)}
        </nav>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Your limits at a glance</CardTitle><CardDescription>The limit at each step, with the section below where you change it.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Limit that applies now</TableHead><TableHead>Change it</TableHead></TableRow></TableHeader>
            <TableBody>
              {glance.map((r) => (
                <TableRow key={r.step} className="align-top">
                  <TableCell className="whitespace-normal"><div className="font-medium">{r.step}</div><div className="text-xs text-muted-foreground">{r.question}</div></TableCell>
                  <TableCell className="max-w-xl whitespace-normal text-sm text-muted-foreground">{r.limit}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm"><a className="underline" href={r.link.href.replace("/settings", "")}>{r.link.label}</a></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SettingsSection id="pause" title="Emergency stop" summary="Stops searching, preparing and applying for a while, then resumes by itself.">
        <PauseCard initial={pause} />
      </SettingsSection>

      <SettingsSection id="find" title="Step 1 · Find jobs" summary={<>Where the agent looks and how far back. Limit: no total limit; postings older than {discovery.max_age_days ?? 30} days are ignored and the same search is not repeated within {discovery.min_rescan_hours ?? 6} hours.</>}>
        {form("find")}
      </SettingsSection>

      <SettingsSection id="score-match" title="Steps 2 and 3 · Score and match" summary={<>Each job found is rated against your profile (score), and a score of {scoring.threshold ?? 65} or more is a match. Limit: no limit on how many are scored or match; the free AI models&apos; daily allowance is the ceiling.</>}>
        {form("score-match")}
      </SettingsSection>

      <SettingsSection id="prepare" title="Step 4 · Prepare resumes and cover letters" summary={<>Writing the resume and cover letter for each match. Limit: up to {autoPrepare.per_run ?? 0} resumes per catch-up round, {autoPrepare.concurrency ?? 3} at the same time; a schedule has its own per-run maximum on the Schedules page. No daily limit.</>}>
        <AutoPrepareCard initial={autoPrepare} />
        {form("prepare")}
      </SettingsSection>

      <SettingsSection id="approve-send" title="Steps 5 and 6 · Approve and send" summary={<>Which prepared applications are approved without you, and how many are sent. Limit: at most {caps.daily_total ?? 15} automatic submissions a day; LinkedIn {caps.daily_linkedin ?? 10} a day and {caps.weekly_linkedin ?? 40} a week.</>}>
        <AutoApplyCard enabled={autoapply.enabled} caps={caps} />
        {form("send")}
        <EmailApplyCard initial={emailApply} mailbox={mailbox ?? ""} />
      </SettingsSection>

      <SettingsSection id="after" title="After applying" summary="Following up on what you sent, and the daily report.">
        {form("after")}
        <DeliveryCard initial={delivery} tz={appTimezone()} mailboxUser={mailbox} />
      </SettingsSection>

      <SettingsSection id="access" title="People and access" summary="Who else can sign in, and which profile they can see.">
        <TeamCard owner={await getOwnerEmail()} members={await getTeam()} profiles={(await listProfiles().catch(() => [])).map((p) => ({ id: p.id, name: p.name }))} />
      </SettingsSection>
    </div>
  );
}
