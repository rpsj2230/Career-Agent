import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Parse the trusted-sites file: one domain per line, "#" starts a comment, a web address or "www." in front is ignored. */
export function parseTrustedSites(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")).filter((l) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(l)))];
}

/**
 * Sites you have told the assistant to trust for applications, one per line, in ~/.career-agent/trusted-sites.txt. Only you can add to it (it is a file on your computer).
 * Read each time, so a line added while the assistant runs takes effect on the next page.
 */
export function trustedSites(): string[] {
  try { return parseTrustedSites(readFileSync(join(homedir(), ".career-agent", "trusted-sites.txt"), "utf8")); } catch { return []; }
}
