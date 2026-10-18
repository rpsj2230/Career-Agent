import { headers } from "next/headers";
import { Brand } from "@/components/app/brand";
import { Nav } from "@/components/app/nav";
import { isRole } from "@/lib/roles";
import { SchemaBanner } from "@/components/app/schema-banner";
import { SignOut } from "@/components/app/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // set by the access check in proxy.ts; if it is ever missing the least access is shown
  const header = (await headers()).get("x-career-role");
  const role = isRole(header) ? header : "viewer";
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:flex-row md:gap-8 md:p-6">
      <aside className="flex flex-col md:w-52 md:shrink-0">
        <Brand className="mb-4 px-3" />
        <Nav role={role} />
        <div className="mt-4 md:mt-auto">
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {role === "viewer" && <div className="mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">View only: you can look at jobs and applications but not change anything.</div>}
        {role === "admin" && <SchemaBanner />}
        {children}
      </main>
    </div>
  );
}
