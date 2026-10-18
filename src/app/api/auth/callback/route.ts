import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/access";
import { authClient, isHttps, publicOrigin } from "@/lib/auth-server";
import { logActivity } from "@/lib/activity";
import { getRole } from "@/lib/owner";
import { homeFor, roleAllows } from "@/lib/roles";

/** Where Google sends you back. Turns the one-time code into a session, then checks the email is allowed (owner, ALLOWED_EMAILS or Team access). */
export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const fail = (why: string) => NextResponse.redirect(new URL(`/login?error=${why}`, origin));
  if (!code) return fail("google");

  const supabase = authClient(await cookies(), isHttps(request));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (error) {
    await logActivity({ kind: "auth.login_failed", level: "warn", message: `Google sign-in failed: ${error.message}`, detail: { ip, reason: error.message } });
    return fail("google");
  }
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? null;
  const role = await getRole(email, true);
  if (!email || !role) {
    await supabase.auth.signOut();
    await logActivity({ kind: "auth.login_failed", level: "warn", message: `Google sign-in refused for ${email ?? "an unknown account"}: not the owner or an allowed email`, detail: { email, ip, reason: "not allowed" } });
    return fail("not-allowed");
  }
  await logActivity({ kind: "auth.login", message: `Signed in with Google: ${email}`, detail: { email, ip, role } });
  const next = safeNext(url.searchParams.get("next"));
  return NextResponse.redirect(new URL(roleAllows(role, next.split("?")[0], "GET") ? next : homeFor(role), origin));
}
