import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** AES-256-GCM with a key derived from a server-side master secret. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
const derive = (master: string) => Buffer.from(hkdfSync("sha256", master, "career-agent", "stored-api-keys-v1", 32));

export function encryptSecret(plain: string, master: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", derive(master), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Returns null when the value is malformed, tampered with, or was encrypted under a different master secret. */
export function decryptSecret(enc: string, master: string): string | null {
  try {
    const [v, iv, tag, ct] = enc.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = createDecipheriv("aes-256-gcm", derive(master), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
