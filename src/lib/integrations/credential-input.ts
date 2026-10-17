/**
 * Checks and tidies the values typed into a "Connect" dialog before they are stored.
 * API keys must be at least 4 characters with no spaces; a port is a short number, an app password may be
 * pasted as Google shows it (with spaces), and a folder may contain spaces.
 */
export type CredentialInput = { ok: true; values: Record<string, string> } | { ok: false; error: string };

export function normalizeCredentialValues(input: Record<string, string>): CredentialInput {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    let v = raw.trim();
    if (!v) continue;
    if (v.length > 300) return { ok: false, error: `${label(key)} is too long` };
    if (key === "imap_port") {
      if (!/^\d{1,5}$/.test(v) || Number(v) < 1 || Number(v) > 65535) return { ok: false, error: "Port must be a number such as 993 (or leave it empty)" };
    } else if (key === "imap_folder") {
      if (v.length < 2) return { ok: false, error: "Folder name is too short (leave it empty to use INBOX)" };
    } else {
      if (/password$/i.test(key)) v = v.replace(/\s+/g, ""); // Google shows app passwords in groups of four
      if (/\s/.test(v)) return { ok: false, error: `${label(key)} must not contain spaces` };
      if (v.length < 4) return { ok: false, error: `${label(key)} is too short (at least 4 characters)` };
    }
    out[key] = v;
  }
  return Object.keys(out).length ? { ok: true, values: out } : { ok: false, error: "Enter at least one value" };
}

const label = (key: string) => key.replace(/^imap_/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
