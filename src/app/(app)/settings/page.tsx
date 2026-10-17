import { searchingCountries } from "@/lib/country-summary";
import { AutoApplyCard } from "@/components/app/autoapply-card";
import { SettingsForm } from "@/components/app/settings-form";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const searching = await searchingCountries();
  const [discovery, scoring, caps, tailoring, blocklist, replies, profile] = await Promise.all([getSetting("discovery"), getSetting("scoring"), getSetting("caps"), getSetting("tailoring"), getSetting("blocklist"), getSetting("replies"), getProfile()])
  const autoapply = await getSetting("autoapply");;
  const titles = [...new Set(profile.experience.map((e) => e.title.trim()).filter(Boolean))].slice(0, 6);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AutoApplyCard enabled={autoapply.enabled} />
      <SettingsForm searching={searching} discovery={discovery} scoring={scoring} caps={caps} tailoring={tailoring} blocklist={blocklist} replies={replies} profileTitles={titles} />
    </div>
  );
}
