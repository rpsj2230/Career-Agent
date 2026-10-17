import { z } from "zod";

export const REMOTE_OPTIONS = ["any", "remote_only", "hybrid_ok", "onsite_only"] as const;
export const REMOTE_LABEL: Record<(typeof REMOTE_OPTIONS)[number], string> = {
  any: "Any (remote, hybrid or on-site)", remote_only: "Remote only", hybrid_ok: "Hybrid or remote", onsite_only: "On-site only",
};

export const WORK_AUTH = [
  { value: "citizen_pr", label: "Citizen or permanent resident", sponsorship: false },
  { value: "has_work_visa", label: "I hold a work visa or permit", sponsorship: false },
  { value: "needs_sponsorship", label: "I need employer visa sponsorship", sponsorship: true },
  { value: "not_authorised", label: "Not authorised to work there yet", sponsorship: true },
] as const;
export const needsSponsorship = (auth: string | null | undefined): boolean | null => WORK_AUTH.find((w) => w.value === auth)?.sponsorship ?? null;

const list = (max: number, item = 80) => z.array(z.string().trim().min(1).max(item)).max(max).default([]);
const money = z.number().finite().nonnegative().max(1e10);

export const CountryPrefInput = z
  .object({
    country: z.string().regex(/^[a-z]{2}$/, "Use a two-letter country code"),
    enabled: z.boolean().default(true),
    titles: list(20), industries: list(20), locations: list(15),
    remote: z.enum(REMOTE_OPTIONS).default("any"),
    salary_min: money.nullable().default(null), salary_max: money.nullable().default(null),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as SGD").nullable().default(null),
    work_authorisation: z.enum(WORK_AUTH.map((w) => w.value) as [string, ...string[]]).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.salary_min !== null && v.salary_max !== null && v.salary_min > v.salary_max) ctx.addIssue({ code: "custom", path: ["salary_max"], message: "The maximum salary must be at least the minimum" });
    if ((v.salary_min !== null || v.salary_max !== null) && !v.currency) ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose the currency your salary figures are in" });
  });
export type CountryPref = z.infer<typeof CountryPrefInput>;

/** Remove blanks and case-insensitive duplicates, keeping the first spelling. */
export function dedupeList(items: string[]): string[] {
  const seen = new Map<string, string>();
  for (const i of items.map((x) => x.trim()).filter(Boolean)) if (!seen.has(i.toLowerCase())) seen.set(i.toLowerCase(), i);
  return [...seen.values()];
}

/** "Product Manager, Program Manager\nBusiness Analyst" -> list. Commas and new lines both separate items. */
export const parseList = (s: string): string[] => dedupeList(s.split(/[,\n;]/));

/** How many source queries one scan of this country makes per integration: titles x max(1, locations). */
export const queriesPerSource = (c: Pick<CountryPref, "titles" | "locations">) => Math.max(1, c.titles.length) * Math.max(1, c.locations.length);

/** Database row -> the shape used by the app. */
export type CountryPrefRow = CountryPref & { updated_at?: string };
export const defaultPref = (country: string, currency: string | null): CountryPref => ({
  country, enabled: true, titles: [], industries: [], locations: [], remote: "any", salary_min: null, salary_max: null, currency, work_authorisation: null, notes: null,
});

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Answers that depend on the country being applied to, taken from that country's entry on the Countries page:
 * the salary you expect there (in that country's currency) and your work authorisation there. They are used instead of
 * the single general answer, so a Singapore form gets SGD and your Singapore status, a German form gets EUR and your EU status.
 */
export function countryAnswers(pref: Pick<CountryPref, "country" | "salary_min" | "salary_max" | "currency" | "work_authorisation"> | undefined): { question: string; answer: string; re: RegExp }[] {
  if (!pref) return [];
  const out: { question: string; answer: string; re: RegExp }[] = [];
  const cur = pref.currency ?? "";
  if (pref.salary_min !== null || pref.salary_max !== null) {
    const range = pref.salary_min !== null && pref.salary_max !== null && pref.salary_max !== pref.salary_min ? `${fmt(pref.salary_min)} - ${fmt(pref.salary_max)}` : fmt((pref.salary_min ?? pref.salary_max)!);
    out.push({ question: `Expected salary (${cur || pref.country.toUpperCase()}, per year)`, answer: `${cur} ${range} per year`.trim(), re: /expected.*(ctc|salary|compensation|pay)|salary expectation/i });
  }
  const auth = WORK_AUTH.find((w) => w.value === pref.work_authorisation);
  if (auth) {
    out.push({ question: "Work authorisation / visa status", answer: auth.label, re: /visa|authori[sz]ation|right to work|eligible to work/i });
    out.push({ question: "Will you now or in the future require visa sponsorship?", answer: auth.sponsorship ? "Yes" : "No", re: /sponsor/i });
  }
  return out;
}
