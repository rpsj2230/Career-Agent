import { createHash, randomBytes } from "node:crypto";

export { parseLinkCode, parseToken } from "./link-code";

/**
 * The link between the browser extension and this app. The extension holds a "link code" (the app's address and a secret); the app keeps
 * only a hash of the secret. Anyone holding the code can read the fill data and the apply queue and mark an application as sent by you,
 * and nothing else (no approving, no skipping, no settings). Making a new code replaces the old one at once. Pure.
 */
export const LINK_SETTING = "extension_link";
export const LEGACY_PROFILE = "legacy";

export type LinkRecord = { hash: string; created_at: string };

export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** "<profile id>.<48 random hex characters>" */
export const makeToken = (profileId: string): string => `${profileId}.${randomBytes(24).toString("hex")}`;

/** The bearer token in an Authorization header, or null. */
export const bearerOf = (authorization: string | null): string | null => (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null);
