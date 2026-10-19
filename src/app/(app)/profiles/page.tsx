import { headers } from "next/headers";
import { ProfilesCard } from "@/components/app/profiles-card";
import { listProfiles, profilesReady } from "@/lib/profiles-store";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const ready = await profilesReady();
  const profiles = ready ? await listProfiles() : [];
  const currentId = (await headers()).get("x-career-profile");
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">People (profiles)</h1>
        <p className="text-sm text-muted-foreground">Run the same job search and applications for several people: yourself, family members, or a second profile of your own.</p>
      </div>
      <ProfilesCard profiles={profiles.map(({ id, name, email, is_default, enabled }) => ({ id, name, email, is_default, enabled }))} currentId={currentId} ready={ready} />
    </div>
  );
}
