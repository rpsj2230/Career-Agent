import "server-only";
import { rawClient } from "@/lib/raw-client";
import { safeEqual } from "@/lib/access";
import { withProfile } from "@/lib/profile-context";
import { profilesEnabled } from "@/lib/scope";
import { getSetting } from "@/lib/settings";
import { bearerOf, hashSecret, LEGACY_PROFILE, LINK_SETTING, parseToken } from "./link";

/**
 * Runs `fn` for the profile that a valid extension link code belongs to, or returns null when the code is missing, malformed, revoked or wrong.
 * These endpoints are reachable without a sign-in (the extension has none), so this check is the only gate: it never says which part was wrong.
 */
export async function withExtensionToken<T>(request: Request, fn: () => Promise<T>): Promise<T | null> {
  const t = parseToken(bearerOf(request.headers.get("authorization")));
  if (!t) return null;
  const multi = await profilesEnabled(rawClient());
  if (multi === (t.profileId === LEGACY_PROFILE)) return null;
  const run = <R>(f: () => Promise<R>) => (multi ? withProfile(t.profileId, f) : f());
  return run(async () => {
    const rec = await getSetting(LINK_SETTING);
    if (!rec.hash || !safeEqual(hashSecret(t.secret), rec.hash)) return null;
    return fn();
  });
}
