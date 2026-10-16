import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

/**
 * Single-user gate. Fails closed: if APP_PASSWORD is not configured nothing is reachable.
 * Browsers/app use HTTP Basic (any username, password = APP_PASSWORD).
 * /api/cron/* additionally accepts `Authorization: Bearer $CRON_SECRET` (Vercel Cron, GitHub Actions).
 */
export function checkAuth(pathname: string, authorization: string | null, env: Record<string, string | undefined>): AuthResult {
  const password = env.APP_PASSWORD;
  if (!password) return { ok: false, status: 503, message: "APP_PASSWORD is not set" };
  if (authorization?.startsWith("Bearer ") && pathname.startsWith("/api/cron/") && env.CRON_SECRET) {
    if (safeEqual(authorization.slice(7), env.CRON_SECRET)) return { ok: true };
  }
  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString();
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(given, password)) return { ok: true };
  }
  return { ok: false, status: 401, message: "Authentication required" };
}
