export type ApplyType = "greenhouse" | "lever" | "email" | "linkedin" | "portal" | "unknown";

export type NormalizedJob = {
  source: string;
  externalId: string;
  title: string;
  company: string;
  country?: string; // ISO-2, lower case
  location?: string;
  url: string;
  description: string;
  salaryText?: string;
  postedAt?: string; // ISO
};

const PORTALS = ["naukri.com", "foundit.in", "monsterindia.com", "shine.com", "indeed.", "instahyre.com", "cutshort.io", "wellfound.com", "internshala.com", "timesjobs.com", "apna.co", "glassdoor."];

/** Which apply path a posting URL needs. Login-gated portals are always assisted. */
export function detectApplyType(url: string): ApplyType {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "unknown"; }
  if (host.endsWith("greenhouse.io")) return "greenhouse";
  if (host.endsWith("lever.co")) return "lever";
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (PORTALS.some((p) => host.includes(p))) return "portal";
  return "unknown";
}

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(pvt|private|ltd|limited|inc|llc|llp|corp|co)\b/g, "").replace(/\s+/g, " ").trim();

/** Same role at the same company in the same country collapses to one job across sources. */
export function dedupeKey(company: string, title: string, country?: string): string {
  return `${clean(company)}|${clean(title)}|${(country ?? "").toLowerCase()}`;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function htmlToText(html: string): string {
  // Greenhouse returns HTML that is itself entity-escaped; decode first, then strip tags.
  const decoded = html.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
  return decoded
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const COUNTRY_NAMES: Record<string, string> = {
  india: "in", "united states": "us", usa: "us", "united kingdom": "gb", uk: "gb", singapore: "sg", australia: "au",
  canada: "ca", germany: "de", france: "fr", netherlands: "nl", "united arab emirates": "ae", uae: "ae", ireland: "ie",
};
/** Best-effort ISO-2 from free text like "Bengaluru, India". */
export function guessCountry(location?: string): string | undefined {
  if (!location) return undefined;
  const l = location.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) if (new RegExp(`\\b${name}\\b`).test(l)) return code;
  return undefined;
}
