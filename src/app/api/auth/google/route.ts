import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/access";
import { authClient, isHttps, publicOrigin } from "@/lib/auth-server";

/** Start "Sign in with Google": ask Supabase for the Google address and send the browser there. */
export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const supabase = authClient(await cookies(), isHttps(request));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${publicOrigin(request)}/api/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return NextResponse.redirect(new URL("/login?error=google", publicOrigin(request)));
  return NextResponse.redirect(data.url);
}
