import type { ApifyActor } from "./apify";

/**
 * Ready-made scraper rows for the portals that have no job-search API. They were picked from the Apify Store listings
 * (public pages, no login or cookies, recently maintained, input documented) and are only suggestions: Apify scrapers are
 * written by third parties and can change their input or stop working, so the first scan shows whether each one works.
 * Open the scraper's page in the Apify Store and compare its Input tab with the JSON here if a run is rejected.
 */
export type ApifyPreset = { key: string; label: string; why: string; countries: string; actor: ApifyActor };

export const APIFY_PRESETS: ApifyPreset[] = [
  {
    key: "linkedin", label: "LinkedIn jobs", countries: "India, Singapore, Australia, Canada, US, UAE",
    why: "HarvestAPI's LinkedIn job search: public pages only, no LinkedIn account or cookies, documented input, can sort by newest.",
    actor: { id: "harvestapi~linkedin-job-search", portal: "linkedin", max_items: 25, enabled: true, countries: [], input: { jobTitles: ["{{title}}"], locations: ["{{location}}"], postedLimit: "{{posted_bucket}}", sortBy: "date", maxItems: "{{max_items}}" } },
  },
  {
    key: "indeed", label: "Indeed jobs", countries: "India, Singapore, Australia, Canada, US, UAE",
    why: "valig's Indeed Jobs Scraper: one actor for every country's Indeed site, with a country, date filter and result limit.",
    actor: { id: "valig~indeed-jobs-scraper", portal: "indeed", max_items: 25, enabled: true, countries: [], input: { country: "{{country_lower}}", title: "{{title}}", location: "{{location}}", limit: "{{max_items}}", datePosted: "{{posted_days}}" } },
  },
  {
    key: "naukri", label: "Naukri (India)", countries: "India",
    why: "Automation Lab's Naukri.com scraper: keyword, location and a job cap (up to 200 a run). Naukri only serves India, so it runs for India only.",
    actor: { id: "automation-lab~naukri-scraper", portal: "naukri", max_items: 25, enabled: true, countries: ["in"], input: { keyword: "{{title}}", location: "{{location}}", maxJobs: "{{max_items}}" } },
  },
  {
    key: "seek", label: "SEEK (Australia)", countries: "Australia",
    why: "DataFetch Labs' SEEK scraper for Australia and New Zealand, with search terms, a location and an item cap. It runs for Australia only.",
    actor: { id: "datafetch_labs~seek-jobs-scraper", portal: "seek", max_items: 25, enabled: true, countries: ["au"], input: { searchTerms: ["{{title}}"], location: "{{location}}", maxItems: "{{max_items}}" } },
  },
];
