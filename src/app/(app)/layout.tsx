import { headers } from "next/headers";
import { Brand } from "@/components/app/brand";
import { Nav } from "@/components/app/nav";
import { ProfileSwitcher } from "@/components/app/profile-switcher";
import { listProfiles } from "@/lib/profiles-store";
import { isRole } from "@/lib/roles";
import { SchemaBanner } from "@/components/app/schema-banner";
import { SignOut } from "@/components/app/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // set by the access check in proxy.ts; if it is ever missing the least access is shown
  const header = (await headers()).get("x-career-role");
  const role = isRole(header) ? header : "viewer";
  // which profile this page is for (set by the access check; none until the profiles migration has been run)
  const h = await headers();
  const currentId = h.get("x-career-profile");
  const allowedIds = new Set((h.get("x-career-profiles") ?? "").split(",").filter(Boolean));
  const profiles = currentId ? (await listProfiles().catch(() => [])).filter((p) => allowedIds.has(p.id)) : [];
  const current = profiles.find((p) => p.id === currentId);
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:flex-row md:gap-8 md:p-6">
      <aside className="flex flex-col md:w-52 md:shrink-0">
        <Brand className="mb-4 px-3" />
        <ProfileSwitcher profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} currentId={currentId} />
        <Nav role={role} />
        <div className="mt-4 md:mt-auto">
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {current && !current.is_default && profiles.length > 1 && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            You are working on <b>{current.name}</b>&apos;s profile. Everything on every page (jobs, applications, resumes, settings, logs) belongs to them.
          </div>
        )}
        {role === "viewer" && <div className="mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">View only: you can look at jobs and applications but not change anything.</div>}
        {role === "admin" && <SchemaBanner />}
        {children}
      </main>
    </div>
  );
}
