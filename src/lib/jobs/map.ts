import { guessCountry, htmlToText, type NormalizedJob } from "./normalize";

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const money = (min?: number, max?: number, cur = "") =>
  min || max ? `${cur}${min ? Math.round(min) : ""}${min && max ? " - " : ""}${max ? Math.round(max) : ""}`.trim() : undefined;

export function mapAdzuna(r: any, country: string): NormalizedJob {
  return {
    source: "adzuna", externalId: String(r.id), title: r.title ?? "", company: r.company?.display_name ?? "Unknown",
    country, location: r.location?.display_name, url: r.redirect_url, description: htmlToText(r.description ?? ""),
    salaryText: money(r.salary_min, r.salary_max), postedAt: iso(r.created),
  };
}

export function mapJSearch(r: any): NormalizedJob {
  const location = [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ");
  return {
    source: "jsearch", externalId: String(r.job_id), title: r.job_title ?? "", company: r.employer_name ?? "Unknown",
    country: typeof r.job_country === "string" && r.job_country.length === 2 ? r.job_country.toLowerCase() : guessCountry(location),
    location, url: r.job_apply_link ?? r.job_google_link, description: r.job_description ?? "",
    salaryText: money(r.job_min_salary, r.job_max_salary, r.job_salary_currency ? `${r.job_salary_currency} ` : ""),
    postedAt: iso(r.job_posted_at_datetime_utc), publisher: typeof r.job_publisher === "string" ? r.job_publisher : undefined,
  };
}

export function mapRemotive(r: any): NormalizedJob {
  return {
    source: "remotive", externalId: String(r.id), title: r.title ?? "", company: r.company_name ?? "Unknown",
    location: r.candidate_required_location, country: guessCountry(r.candidate_required_location),
    url: r.url, description: htmlToText(r.description ?? ""), salaryText: r.salary || undefined, postedAt: iso(r.publication_date),
  };
}

export function mapGreenhouse(r: any, board: string): NormalizedJob {
  const location = r.location?.name;
  return {
    source: `greenhouse:${board}`, externalId: String(r.id), title: r.title ?? "", company: r.company_name ?? board,
    location, country: guessCountry(location), url: r.absolute_url, description: htmlToText(r.content ?? ""), postedAt: iso(r.updated_at),
  };
}

export function mapLever(r: any, company: string): NormalizedJob {
  const location = r.categories?.location;
  return {
    source: `lever:${company}`, externalId: String(r.id), title: r.text ?? "", company,
    location, country: guessCountry(location), url: r.hostedUrl ?? r.applyUrl,
    description: r.descriptionPlain ?? htmlToText(r.description ?? ""), postedAt: iso(r.createdAt),
  };
}
