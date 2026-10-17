import { SettingsForm } from "@/components/app/settings-form";
import { getProfile } from "@/lib/profile/store";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [discovery, scoring, caps, tailoring, blocklist, profile] = await Promise.all([getSetting("discovery"), getSetting("scoring"), getSetting("caps"), getSetting("tailoring"), getSetting("blocklist"), getProfile()]);
  const titles = [...new Set(profile.experience.map((e) => e.title.trim()).filter(Boolean))].slice(0, 6);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm discovery={discovery} scoring={scoring} caps={caps} tailoring={tailoring} blocklist={blocklist} profileTitles={titles} />
    </div>
  );
}
