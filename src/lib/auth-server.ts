import { createServerClient } from "@supabase/ssr";
import type { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Supabase Auth client for route handlers, using the service key already configured on the server, so no
 * extra public key is needed. Sessions are stored in httpOnly cookies the browser JavaScript cannot read.
 */
export function authClient(store: CookieStore, secure: boolean) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createServerClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, { ...options, httpOnly: true, secure })),
    },
  });
}

export const isHttps = (request: Request) => request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";

/** The address people use to reach the site (behind Vercel the request URL can show an internal host). */
export function publicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
