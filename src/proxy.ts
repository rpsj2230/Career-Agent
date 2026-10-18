import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cronBearerValid, decideAccess, isPublic } from "@/lib/access";
import { getRole } from "@/lib/owner";
import { homeFor, roleAllows } from "@/lib/roles";

const text = (status: number, body: string) => new NextResponse(body, { status });
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isPublic(pathname)) return NextResponse.next();
  if (cronBearerValid(pathname, request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.next();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return text(503, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const secure = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  // The Supabase client refreshes expiring sessions and hands back cookies/headers to attach to the response.
  const pending: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const pendingHeaders: Record<string, string> = {};
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => { pending.push({ name, value, options }); response.cookies.set(name, value, { ...options, httpOnly: true, secure }); });
        Object.entries(headers).forEach(([k, v]) => { pendingHeaders[k] = v; response.headers.set(k, v); });
      },
    },
  });
  // getUser() asks Supabase to validate the token; it is never trusted from the cookie alone.
  const { data } = await supabase.auth.getUser();

  const role = data.user ? await getRole(data.user.email) : null;
  const access = decideAccess({ user: data.user, allowlist: role && data.user?.email ? [data.user.email.toLowerCase()] : [], isApi });
  switch (access.kind) {
    case "allow": {
      if (!role || !roleAllows(role, pathname, request.method)) {
        if (isApi) return json(403, "Your account does not have access to this");
        return NextResponse.redirect(new URL(role ? homeFor(role) : "/login?error=not-allowed", request.url));
      }
      // tell the pages who is asking (always overwritten here, so a browser cannot send its own value)
      const forwarded = new Headers(request.headers);
      forwarded.set("x-career-role", role);
      const out = NextResponse.next({ request: { headers: forwarded } });
      pending.forEach(({ name, value, options }) => out.cookies.set(name, value, { ...options, httpOnly: true, secure }));
      Object.entries(pendingHeaders).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }
    case "unauthorized": return json(401, "Sign in required");
    case "forbidden": return isApi ? json(403, "This account is not allowed") : NextResponse.redirect(new URL("/login?error=not-allowed", request.url));
    case "login": {
      const to = new URL("/login", request.url);
      if (pathname !== "/") to.searchParams.set("next", pathname + search);
      return NextResponse.redirect(to);
    }
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
