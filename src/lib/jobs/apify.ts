import { z } from "zod";
import { COUNTRY_NAME_MAP } from "@/lib/countries";
import { detectApplyType, guessCountry, htmlToText, type NormalizedJob } from "./normalize";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Hosted scrapers (Apify). The portals that have no job-search API (LinkedIn, Naukri, SEEK/JobStreet/JobsDB, Indeed ...)
 * are read by ready-made "actors" that Apify runs on its own servers against the portals' public pages. This app only
 * calls Apify's API with your token: nothing here logs in to those portals, and your accounts are never involved.
 * Each actor is described once (which actor, which portal it reads, the input it expects), and then runs automatically
 * on every schedule.
 */
export const ApifyActor = z.object({
  /** Apify actor id as shown in the Store, e.g. "username~actor-name" ("username/actor-name" is accepted) */
  id: z.string().trim().regex(/^[A-Za-z0-9_.-]+[~/][A-Za-z0-9_.-]+$/, "Use the actor id from the Apify Store, like username~actor-name"),
  /** the portal this actor reads, so jobs are labelled and filtered by it: linkedin, naukri, indeed, seek, jobstreet ... */
  portal: z.string().trim().min(1).max(40),
  /** the actor's input. {{title}} {{location}} {{country}} {{country_name}} {{days}} {{max_items}} are filled in for every search */
  input: z.record(z.string(), z.unknown()).default({}),
  max_items: z.number().int().min(1).max(500).default(50),
  enabled: z.boolean().default(true),
});
export type ApifyActor = z.infer<typeof ApifyActor>;
export const ApifySettings = z.object({
  actors: z.array(ApifyActor).max(20).default([]),
  /** most jobs to fetch through Apify in a calendar month (0 = no limit). Keeps scheduled runs inside the free credit. */
  monthly_item_budget: z.number().int().min(0).max(1_000_000).default(2500),
});

export type TemplateVars = { title: string; location: string; country: string; country_name: string; days: number; max_items: number };

/** Fill the placeholders anywhere in a JSON input. A value that is exactly one placeholder keeps its type (numbers stay numbers). */
export function fillTemplate(input: unknown, v: TemplateVars): unknown {
  if (typeof input === "string") {
    const whole = input.match(/^\{\{(\w+)\}\}$/);
    if (whole && whole[1] in v) return (v as Record<string, unknown>)[whole[1]];
    return input.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? String((v as Record<string, unknown>)[k]) : m));
  }
  if (Array.isArray(input)) return input.map((x) => fillTemplate(x, v));
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([k, x]) => [k, fillTemplate(x, v)]));
  return input;
}

export const templateVars = (q: { title: string; location?: string; country: string }, days: number, maxItems: number): TemplateVars =>
  ({ title: q.title, location: q.location ?? COUNTRY_NAME_MAP[q.country] ?? q.country.toUpperCase(), country: q.country.toUpperCase(), country_name: COUNTRY_NAME_MAP[q.country] ?? q.country.toUpperCase(), days, max_items: maxItems });

const iso = (v: unknown): string | undefined => {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : /^\d{9,13}$/.test(String(v)) ? Number(v) : null; // unix seconds or milliseconds
  const d = new Date(n !== null ? (n < 1e12 ? n * 1000 : n) : String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** First usable value among the keys an actor might use. Objects are reduced to a name, arrays to their first usable entry. */
function pick(item: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const path = k.split(".");
    let v: any = item;
    for (const p of path) v = v?.[p];
    const s = flat(v);
    if (s) return s;
  }
  return undefined;
}
function flat(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(", ") || undefined;
  if (typeof v === "object") return flat((v as any).name ?? (v as any).text ?? (v as any).displayName ?? (v as any).label ?? (v as any).city);
  return undefined;
}

const KEYS = {
  title: ["title", "jobTitle", "positionName", "position", "job_title", "name", "role"],
  company: ["companyName", "company", "company_name", "employer", "employerName", "organization", "hiringOrganization.name", "company.name"],
  location: ["location", "jobLocation", "formattedLocation", "locations", "city", "place", "job_location", "address"],
  page: ["jobUrl", "jobLink", "jdURL", "jdUrl", "url", "link", "detailUrl", "jobPostingUrl", "job_url", "postingUrl"],
  apply: ["applyUrl", "applyLink", "externalApplyLink", "apply_url", "applicationUrl", "directApplyUrl"],
  description: ["descriptionText", "description", "jobDescription", "job_description", "descriptionHtml", "snippet", "summary", "details", "content"],
  id: ["id", "jobId", "job_id", "trackingId", "postingId", "listingId", "referenceId"],
  posted: ["postedAt", "postedDate", "datePosted", "publishedAt", "listedAt", "date", "postDate", "posted", "createdAt", "listingDate"],
  salary: ["salary", "salaryText", "salaryRange", "compensation", "pay", "salaryInfo", "salaryDescription"],
};

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/**
 * One item from an actor's dataset -> a job. Actors name their fields differently, so each field is read from the usual
 * candidates. The portal's own job page is kept as the job's link (so you can open and apply there); when the item also names an
 * employer's Greenhouse or Lever application page, that page is used instead, because it can be applied for automatically.
 * Returns null when the item has no title or no link (nothing that could be opened or applied for).
 */
export function mapApifyItem(item: any, actor: Pick<ApifyActor, "id" | "portal">, fallbackCountry?: string): NormalizedJob | null {
  if (!item || typeof item !== "object") return null;
  const title = pick(item, KEYS.title);
  const page = pick(item, KEYS.page);
  const apply = pick(item, KEYS.apply);
  const best = apply && /^https?:\/\//.test(apply) && ["greenhouse", "lever"].includes(detectApplyType(apply)) ? apply : page ?? apply;
  if (!title || !best || !/^https?:\/\//.test(best)) return null;
  const location = pick(item, KEYS.location);
  const rawDesc = pick(item, KEYS.description) ?? "";
  const description = /<\/?[a-z][\s\S]*>/i.test(rawDesc) ? htmlToText(rawDesc) : rawDesc;
  const country = (typeof item.countryCode === "string" && item.countryCode.length === 2 ? item.countryCode.toLowerCase() : undefined) ?? guessCountry(location) ?? fallbackCountry;
  return {
    source: `apify:${actor.id.replace("/", "~")}`,
    externalId: pick(item, KEYS.id) ?? hash(best),
    title, company: pick(item, KEYS.company) ?? "Unknown", country, location, url: best, description,
    salaryText: pick(item, KEYS.salary), postedAt: iso(pick(item, KEYS.posted)), publisher: actor.portal,
  };
}

export type ApifyFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Run an actor and wait for its results (Apify's run-sync-get-dataset-items endpoint, which holds the request open until the
 * run ends or the timeout is reached). Failures become messages that say what to do.
 */
export async function runActor(token: string, actor: ApifyActor, vars: TemplateVars, fetchImpl: ApifyFetch = fetch as unknown as ApifyFetch, timeoutSecs = 150): Promise<unknown[]> {
  const id = actor.id.replace("/", "~");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(id)}/run-sync-get-dataset-items?${new URLSearchParams({ timeout: String(timeoutSecs), limit: String(actor.max_items), clean: "true" })}`;
  let res;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(fillTemplate(actor.input, vars)), signal: AbortSignal.timeout((timeoutSecs + 20) * 1000) });
  } catch (e) {
    throw new Error(`Could not reach Apify: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("Apify rejected the token. Copy it again from Apify > Settings > Integrations.");
  if (res.status === 404) throw new Error(`Apify has no actor "${id}". Check the id in the Apify Store.`);
  if (res.status === 402) throw new Error("Apify says the account is out of credit for this run. Check your Apify usage limits.");
  if (res.status === 400) throw new Error(`Apify rejected the input for "${id}". Compare the input with the actor's documentation.`);
  if (!res.ok) throw new Error(`Apify returned HTTP ${res.status} for "${id}".`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
