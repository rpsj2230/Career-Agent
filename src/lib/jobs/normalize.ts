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
  publisher?: string; // site the posting was published on, when an aggregator tells us (JSearch)
  /** Structured pay when the source gives numbers. `estimated` = the job site's own guess, not the employer's. */
  salary?: { min?: number; max?: number; currency?: string; period?: "year" | "month" | "week" | "day" | "hour"; estimated?: boolean };
};

const PORTALS = ["naukri.com", "foundit.in", "monsterindia.com", "shine.com", "indeed.", "instahyre.com", "cutshort.io", "wellfound.com", "internshala.com", "timesjobs.com", "apna.co", "glassdoor."];

/** Which apply path a posting URL needs. Login-gated portals are always assisted. */
export function detectApplyType(url: string): ApplyType {
  if (/^mailto:/i.test(url.trim())) return "email";
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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", bull: "•", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", rupee: "₹", laquo: "«", raquo: "»", deg: "°", times: "×",
};

/** Turn character references (&amp; &middot; &#183; &#x2F;) into the characters they stand for. Unknown names are left as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (m, dec, hex, name) => {
    if (dec || hex) { const code = dec ? Number(dec) : parseInt(hex, 16); try { return String.fromCodePoint(code); } catch { return m; } }
    return ENTITIES[String(name).toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  // Greenhouse returns HTML that is itself entity-escaped; decode first, then strip tags.
  const decoded = decodeEntities(html);
  return decoded
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/<[^>]*$/, "") // a tag cut off at the end of a slice
    .replace(/^[^<]*?>/, (m) => (/^[^<>]{0,400}>$/.test(m) && /=\s*"/.test(m) ? "" : m)) // the tail of a tag cut off at the start of a slice
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** A short field (company, place, title) as plain text: no tags, no cut-off tag, no entities. Empty when nothing readable is left. */
export function plainField(s: string | null | undefined): string {
  return htmlToText(String(s ?? "")).replace(/\s+/g, " ").trim();
}

const COUNTRY_NAMES: Record<string, string> = {
  india: "in", "united states": "us", usa: "us", "united kingdom": "gb", uk: "gb", singapore: "sg", australia: "au",
  canada: "ca", germany: "de", france: "fr", netherlands: "nl", "united arab emirates": "ae", uae: "ae", ireland: "ie",
};
const CITY_COUNTRY: Record<string, string> = {
  bengaluru: "in", bangalore: "in", mumbai: "in", pune: "in", delhi: "in", "new delhi": "in", gurgaon: "in", gurugram: "in", noida: "in", hyderabad: "in", chennai: "in", kolkata: "in", ahmedabad: "in",
  london: "gb", manchester: "gb", dubai: "ae", "abu dhabi": "ae", sydney: "au", melbourne: "au", toronto: "ca", vancouver: "ca", berlin: "de", munich: "de", amsterdam: "nl", dublin: "ie",
};
/** Best-effort ISO-2 from free text like "Bengaluru, India". */
export function guessCountry(location?: string): string | undefined {
  if (!location) return undefined;
  const l = location.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) if (new RegExp(`\\b${name}\\b`).test(l)) return code;
  for (const [city, code] of Object.entries(CITY_COUNTRY)) if (new RegExp(`\\b${city}\\b`).test(l)) return code;
  return undefined;
}
