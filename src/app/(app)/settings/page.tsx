import { searchingCountries } from "@/lib/country-summary";
import { AutoApplyCard } from "@/components/app/autoapply-card";
import { DeliveryCard } from "@/components/app/delivery-card";
import { PauseCard } from "@/components/app/pause-card";
import { AutoPrepareCard } from "@/components/app/auto-prepare-card";
import { EmailApplyCard } from "@/components/app/email-apply-card";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { appTimezone } from "@/lib/time";
import { SettingsForm } from "@/components/app/settings-form";
import { getProfile } from "@/lib/profile/store";
import { dedupeList } from "@/lib/country-prefs";
import { getSetting } from "@/lib/settings";
import { TeamCard } from "@/components/app/team-card";
import { getOwnerEmail, getTeam } from "@/lib/owner";

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
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <PauseCard initial={pause} />
      <TeamCard owner={await getOwnerEmail()} members={await getTeam(true)} />
      <AutoApplyCard enabled={autoapply.enabled} caps={caps} />
      <AutoPrepareCard initial={autoPrepare} />
      <EmailApplyCard initial={emailApply} mailbox={mailbox ?? ""} />
      <DeliveryCard initial={delivery} tz={appTimezone()} mailboxUser={mailbox} />
      <SettingsForm searching={searching} discovery={discovery} scoring={scoring} caps={caps} tailoring={tailoring} blocklist={blocklist} replies={replies} roles={roles} />
    </div>
  );
}
