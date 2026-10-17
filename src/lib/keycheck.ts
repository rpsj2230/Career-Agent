/**
 * Explain what kind of Supabase key is configured, without ever revealing it. Used only to turn the vague
 * "Supabase refused the request" into something you can fix.
 */
export type KeyKind = "service_role" | "anon" | "secret" | "publishable" | "unknown" | "missing";
export type KeyReport = { kind: KeyKind; keyProject: string | null; urlProject: string | null; sameProject: boolean | null; urlLooksRight: boolean; whitespace: boolean; expired: boolean };

const b64json = (s: string): Record<string, unknown> | null => {
  try { return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; }
};

export function checkKey(rawKey: string | undefined, rawUrl: string | undefined, now = Date.now()): KeyReport {
  const key = rawKey ?? "", url = rawUrl ?? "";
  const urlProject = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.(?:co|in|net)\/?$/i)?.[1]?.toLowerCase() ?? null;
  const base = { urlProject, urlLooksRight: urlProject !== null, whitespace: key !== key.trim() || /\s/.test(key.trim()) };
  if (!key.trim()) return { ...base, kind: "missing", keyProject: null, sameProject: null, expired: false };
  const k = key.trim();
  if (k.startsWith("sb_secret_")) return { ...base, kind: "secret", keyProject: null, sameProject: null, expired: false };
  if (k.startsWith("sb_publishable_")) return { ...base, kind: "publishable", keyProject: null, sameProject: null, expired: false };
  const payload = k.split(".").length === 3 ? b64json(k.split(".")[1]) : null;
  if (!payload) return { ...base, kind: "unknown", keyProject: null, sameProject: null, expired: false };
  const role = payload.role, ref = typeof payload.ref === "string" ? payload.ref.toLowerCase() : null;
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  return { ...base, kind: role === "service_role" ? "service_role" : role === "anon" ? "anon" : "unknown", keyProject: ref, sameProject: ref && urlProject ? ref === urlProject : null, expired: exp !== null && exp < now };
}

/** Plain-language findings, most likely cause first. Empty when the key looks fine. */
export function keyProblems(r: KeyReport): string[] {
  const out: string[] = [];
  if (r.kind === "missing") out.push("SUPABASE_SERVICE_ROLE_KEY is not set in Vercel for this deployment.");
  if (r.kind === "anon") out.push("The key in Vercel is the anon key. Use the service_role key instead.");
  if (r.kind === "publishable") out.push("The key in Vercel is the publishable key. Use the secret key (sb_secret_...) or the legacy service_role key.");
  if (r.kind === "unknown") out.push("The key in Vercel is not a recognisable Supabase key. Re-copy the service_role (or sb_secret_) key.");
  if (r.whitespace) out.push("The key contains a space or line break. Paste it again without any.");
  if (r.expired) out.push("The key has expired.");
  if (r.sameProject === false) out.push(`The key belongs to project "${r.keyProject}" but SUPABASE_URL points to "${r.urlProject}". Take both from the same Supabase project.`);
  if (!r.urlLooksRight) out.push("SUPABASE_URL does not look like https://<project>.supabase.co (no trailing path or slash).");
  return out;
}
