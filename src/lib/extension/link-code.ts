/** The parts of the extension link that run in the browser too (no node modules). Pure. */

export function parseToken(token: string | null | undefined): { profileId: string; secret: string } | null {
  const m = (token ?? "").trim().match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|legacy)\.([0-9a-f]{48})$/i);
  return m ? { profileId: m[1].toLowerCase(), secret: m[2].toLowerCase() } : null;
}

/** What you paste into the extension once: the app's address, a bar, the token. */
export const makeLinkCode = (origin: string, token: string): string => `${origin.replace(/\/+$/, "")}|${token}`;

export function parseLinkCode(code: string | null | undefined): { origin: string; token: string } | null {
  const [origin, token, extra] = (code ?? "").trim().split("|");
  if (extra !== undefined || !origin || !token) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    if (!parseToken(token)) return null;
    return { origin: u.origin, token };
  } catch { return null; }
}

