import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/access";
import { authClient, isHttps, NEXT_COOKIE, publicOrigin } from "@/lib/auth-server";

/** Start "Sign in with Google": ask Supabase for the Google address and send the browser there. */
export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const supabase = authClient(await cookies(), isHttps(request));
  // The address given to Supabase must be EXACTLY the one on its Redirect URLs list, so it carries no query string:
  // where to go afterwards travels in a short-lived cookie instead.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${publicOrigin(request)}/api/auth/callback`, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return NextResponse.redirect(new URL("/login?error=google", publicOrigin(request)));
  const res = NextResponse.redirect(data.url);
  res.cookies.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure: isHttps(request), path: "/", maxAge: 600 });
  return res;
}
