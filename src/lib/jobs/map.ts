import { defaultCurrency } from "@/lib/countries";
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
  const currency = defaultCurrency(country);
  const estimated = String(r.salary_is_predicted) === "1"; // Adzuna's own estimate, not the employer's figure
  const text = money(r.salary_min, r.salary_max, currency ? `${currency} ` : "");
  return {
    source: "adzuna", externalId: String(r.id), title: r.title ?? "", company: r.company?.display_name ?? "Unknown",
    country, location: r.location?.display_name, url: r.redirect_url, description: htmlToText(r.description ?? ""),
    salaryText: text ? `${text}${estimated ? " (estimated)" : ""}` : undefined,
    postedAt: iso(r.created),
    salary: r.salary_min || r.salary_max ? { min: r.salary_min || undefined, max: r.salary_max || undefined, currency, period: "year", estimated } : undefined,
  };
}

const JSEARCH_PERIODS: Record<string, "year" | "month" | "week" | "day" | "hour"> = { YEAR: "year", YEARLY: "year", MONTH: "month", MONTHLY: "month", WEEK: "week", WEEKLY: "week", DAY: "day", DAILY: "day", HOUR: "hour", HOURLY: "hour" };

export function mapJSearch(r: any): NormalizedJob {
  const location = [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", ");
  return {
    source: "jsearch", externalId: String(r.job_id), title: r.job_title ?? "", company: r.employer_name ?? "Unknown",
    country: typeof r.job_country === "string" && r.job_country.length === 2 ? r.job_country.toLowerCase() : guessCountry(location),
    location, url: r.job_apply_link ?? r.job_google_link, description: r.job_description ?? "",
    salaryText: money(r.job_min_salary, r.job_max_salary, r.job_salary_currency ? `${r.job_salary_currency} ` : ""),
    postedAt: iso(r.job_posted_at_datetime_utc), publisher: typeof r.job_publisher === "string" ? r.job_publisher : undefined,
    salary: r.job_min_salary || r.job_max_salary ? { min: r.job_min_salary || undefined, max: r.job_max_salary || undefined, currency: r.job_salary_currency || undefined, period: JSEARCH_PERIODS[String(r.job_salary_period ?? "").toUpperCase()] ?? "year" } : undefined,
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

/** Arbeitnow: { data: [{ slug, title, company_name, description (HTML), location, remote, url, created_at (unix seconds) }] } */
export function mapArbeitnow(r: any): NormalizedJob {
  const location = [r.location, r.remote ? "Remote" : ""].filter(Boolean).join(", ");
  return {
    source: "arbeitnow", externalId: String(r.slug ?? r.url), title: r.title ?? "", company: r.company_name ?? "Unknown",
    location, country: guessCountry(r.location) ?? (r.remote ? undefined : "de"), url: r.url, description: htmlToText(r.description ?? ""),
    postedAt: typeof r.created_at === "number" ? iso(r.created_at * 1000) : iso(r.created_at),
  };
}

/** Remote OK: [ legal-notice, { id, position, company, location, description (HTML), url, date, epoch, salary_min, salary_max } ... ] */
export function mapRemoteOk(r: any): NormalizedJob {
  const min = Number(r.salary_min) || undefined, max = Number(r.salary_max) || undefined;
  return {
    source: "remoteok", externalId: String(r.id), title: r.position ?? r.title ?? "", company: r.company ?? "Unknown",
    location: r.location || "Remote", country: guessCountry(r.location), url: r.url ?? r.apply_url, description: htmlToText(r.description ?? ""),
    postedAt: iso(r.date) ?? (typeof r.epoch === "number" ? iso(r.epoch * 1000) : undefined),
    salaryText: money(min, max, "USD "), salary: min || max ? { min, max, currency: "USD", period: "year" } : undefined,
  };
}

/** Jobicy: { jobs: [{ id, url, jobTitle, companyName, jobGeo, jobDescription (HTML), pubDate, annualSalaryMin, annualSalaryMax, salaryCurrency }] } */
export function mapJobicy(r: any): NormalizedJob {
  const min = Number(r.annualSalaryMin) || undefined, max = Number(r.annualSalaryMax) || undefined;
  const currency = typeof r.salaryCurrency === "string" && /^[A-Z]{3}$/.test(r.salaryCurrency) ? r.salaryCurrency : undefined;
  return {
    source: "jobicy", externalId: String(r.id), title: htmlToText(r.jobTitle ?? ""), company: htmlToText(r.companyName ?? "") || "Unknown",
    location: r.jobGeo || "Remote", country: guessCountry(r.jobGeo), url: r.url, description: htmlToText(r.jobDescription ?? r.jobExcerpt ?? ""),
    postedAt: iso(r.pubDate), salaryText: money(min, max, currency ? `${currency} ` : ""), salary: min || max ? { min, max, currency, period: "year" } : undefined,
  };
}

/**
 * MyCareersFuture (Singapore government job portal). Salaries there are monthly SGD figures. The field names below are the ones
 * its public search returns; each is read defensively so a missing field never drops the job.
 */
export function mapMcf(r: any): NormalizedJob {
  const district = r.address?.districts?.[0];
  const location = [r.address?.street ?? r.address?.block, district?.region, "Singapore"].filter(Boolean).join(", ");
  const min = r.salary?.minimum, max = r.salary?.maximum;
  const monthly = /month/i.test(String(r.salary?.type?.salaryType ?? "Monthly"));
  const id = String(r.uuid ?? r.id ?? "");
  return {
    source: "mcf", externalId: id, title: r.title ?? "", company: r.postedCompany?.name ?? r.hiringCompany?.name ?? "Unknown",
    country: "sg", publisher: "mycareersfuture", location, url: r.metadata?.jobDetailsUrl ?? (id ? `https://www.mycareersfuture.gov.sg/job/${id}` : ""),
    description: htmlToText(r.description ?? ""),
    salaryText: min || max ? `SGD ${min ? Math.round(min) : ""}${min && max ? " - " : ""}${max ? Math.round(max) : ""} ${monthly ? "per month" : "per year"}` : undefined,
    postedAt: iso(r.metadata?.originalPostingDate ?? r.metadata?.newPostingDate),
    salary: min || max ? { min: min || undefined, max: max || undefined, currency: "SGD", period: monthly ? "month" : "year" } : undefined,
  };
}

export function mapAshby(r: any, org: string): NormalizedJob {
  const location = r.location ?? r.address?.postalAddress?.addressLocality;
  return {
    source: `ashby:${org}`, externalId: String(r.id), title: r.title ?? "", company: r.companyName ?? org,
    location, country: guessCountry(String(location ?? "")), url: r.jobUrl ?? r.applyUrl ?? "",
    description: r.descriptionPlain ?? htmlToText(r.descriptionHtml ?? ""), postedAt: iso(r.publishedAt ?? r.publishedDate),
    salaryText: r.compensation?.compensationTierSummary ?? r.compensation?.scrapeableCompensationSalarySummary ?? undefined,
  };
}

export function mapWorkable(r: any, account: string): NormalizedJob {
  const location = [r.city, r.state, r.country].filter(Boolean).join(", ");
  return {
    source: `workable:${account}`, externalId: String(r.shortcode ?? r.id), title: r.title ?? "", company: r.company ?? account,
    location, country: guessCountry(location), url: r.url ?? r.shortlink ?? r.application_url ?? "",
    description: htmlToText(r.description ?? ""), postedAt: iso(r.published_on ?? r.created_at),
  };
}

export function mapRecruitee(r: any, company: string): NormalizedJob {
  const location = r.location ?? [r.city, r.country].filter(Boolean).join(", ");
  return {
    source: `recruitee:${company}`, externalId: String(r.id), title: r.title ?? "", company: r.company_name ?? company,
    location, country: (typeof r.country_code === "string" && r.country_code.length === 2 ? r.country_code.toLowerCase() : undefined) ?? guessCountry(String(location ?? "")),
    url: r.careers_url ?? "", description: htmlToText(`${r.description ?? ""}\n${r.requirements ?? ""}`), postedAt: iso(r.published_at ?? r.created_at),
  };
}
