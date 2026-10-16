import { Nav } from "@/components/app/nav";
import { SignOut } from "@/components/app/sign-out";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:flex-row md:gap-8 md:p-6">
      <aside className="flex flex-col md:w-52 md:shrink-0">
        <div className="mb-3 px-3 text-lg font-semibold">Career Agent</div>
        <Nav />
        <div className="mt-4 md:mt-auto">
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
