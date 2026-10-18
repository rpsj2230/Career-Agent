import { LoginForm } from "@/components/app/login-form";
import { safeNext } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <LoginForm next={safeNext(sp.next)} notAllowed={sp.error === "not-allowed"} googleError={sp.error === "google"} />
    </main>
  );
}
