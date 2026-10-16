import { SettingsForm } from "@/components/app/settings-form";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [discovery, scoring, caps] = await Promise.all([getSetting("discovery"), getSetting("scoring"), getSetting("caps")]);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm discovery={discovery} threshold={scoring.threshold} caps={caps} />
    </div>
  );
}
