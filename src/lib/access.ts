import { timingSafeEqual } from "node:crypto";

/** Pages and endpoints reachable without a session. (The Telegram webhook is public but verifies Telegram's secret header and your chat id itself.) Everything else needs an allowed signed-in user. */
export const PUBLIC_PATHS = ["/login", "/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/telegram/webhook"];

export const isPublic = (pathname: string) => PUBLIC_PATHS.includes(pathname);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Emails are compared case-insensitively; blanks are dropped. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Scheduled jobs (Vercel Cron, GitHub Actions) authenticate with a bearer token, on /api/cron/* only. */
export function cronBearerValid(pathname: string, authorization: string | null, secret: string | undefined): boolean {
  return !!secret && pathname.startsWith("/api/cron/") && !!authorization?.startsWith("Bearer ") && safeEqual(authorization.slice(7), secret);
}

/** Only same-site relative paths may be used as a post-login destination (blocks open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?!\/|\\)[^\s]*$/.test(next) ? next : "/";
}

export type Access =
  | { kind: "allow" }
  | { kind: "login" }          // pages: send to /login
  | { kind: "unauthorized" }   // APIs: 401 JSON
  | { kind: "forbidden" };     // signed in, but the email is not the owner / on the allowlist

/**
 * Decide access for a non-public, non-cron request.
 * Fails closed: an empty allowlist (no owner account yet) admits nobody, so a missing row can never open the app.
 */
export function decideAccess(i: { user: { email?: string | null } | null; allowlist: string[]; isApi: boolean }): Access {
  if (!i.user) return i.isApi ? { kind: "unauthorized" } : { kind: "login" };
  const email = i.user.email?.toLowerCase();
  return email && i.allowlist.includes(email) ? { kind: "allow" } : { kind: "forbidden" };
}
