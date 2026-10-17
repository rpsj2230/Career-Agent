import type { MasterProfile } from "@/lib/types";

/** Industry labels and the words in a resume that point to them. */
const INDUSTRIES: { name: string; re: RegExp }[] = [
  { name: "Digital Agency / IT Services", re: /\b(digital agency|agency|it services|web (development|projects?|builds?)|websites?|portals?|software (delivery|development)|implementation|systems? integration|digital delivery|ux\b|ui\/ux)\b/gi },
  { name: "eCommerce & Retail", re: /\b(e-?commerce|online stores?|shopify|woocommerce|magento|retail|merchandis\w*|marketplace|d2c)\b/gi },
  { name: "SaaS & Technology", re: /\b(saas|cloud|software products?|platform|devops|api|startup|ai[- ]enabled|artificial intelligence|machine learning)\b/gi },
  { name: "Fintech, Banking & Insurance", re: /\b(fintech|banks?|banking|payments?|lending|insurance|wealth|financial services|trading|capital markets)\b/gi },
  { name: "Healthcare & Life Sciences", re: /\b(health\w*|medical|pharma\w*|hospitals?|clinical|life sciences|biotech)\b/gi },
  { name: "Education & Training", re: /\b(universit\w*|education\w*|learning|training|schools?|edtech|faculty|academ\w*)\b/gi },
  { name: "Government & Public Sector", re: /\b(government|public sector|statutory boards?|ministry|municipal|civic)\b/gi },
  { name: "Transport & Logistics", re: /\b(transport\w*|transit|logistics|supply chain|shipping|fleet|aviation|airline|railway|freight)\b/gi },
  { name: "Telecom, Media & Marketing", re: /\b(telecom\w*|media|broadcast\w*|publishing|advertis\w*|marketing|seo\b|branding)\b/gi },
  { name: "Manufacturing, Energy & Utilities", re: /\b(manufactur\w*|energy|oil and gas|utilities|industrial|gas\b|power|renewable)\b/gi },
  { name: "Travel & Hospitality", re: /\b(travel|hotels?|hospitality|tourism|restaurants?)\b/gi },
  { name: "Consulting & Professional Services", re: /\b(consult\w*|advisory|professional services|outsourc\w*|bpo)\b/gi },
  { name: "Real Estate & Construction", re: /\b(real estate|property|construction|architecture|facilities)\b/gi },
  { name: "Non-profit & Social Impact", re: /\b(non-?profit|ngo|charit\w*|volunteer\w*|social impact|community)\b/gi },
];

const count = (text: string, re: RegExp) => (text.match(new RegExp(re.source, re.flags)) ?? []).length;

/**
 * Industries your resume points to, strongest first. Words in the headline and summary count triple, job titles double, and
 * bullets once; an industry needs a real signal (score of 3 or more, or the single strongest one) to be listed.
 */
export function inferIndustries(p: MasterProfile, max = 4): string[] {
  const head = `${p.basics.headline} ${p.basics.summary}`;
  const titles = p.experience.map((e) => `${e.title} ${e.company}`).join(" . ");
  const body = [...p.experience.flatMap((e) => e.bullets.map((b) => b.text)), ...p.highlights.map((h) => h.text), ...p.caseStudies.map((c) => c.title)].join(" . ");
  const scored = INDUSTRIES.map((i) => ({ name: i.name, score: 3 * count(head, i.re) + 2 * count(titles, i.re) + count(body, i.re) })).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  return scored.filter((s, i) => i === 0 || s.score >= 3).slice(0, max).map((s) => s.name);
}

const TECH = /digital|it services|saas|technology|ecommerce|telecom|media/i;
const FINANCE = /fintech|bank|insurance|financial/i;

/** The main business hubs of a country, ordered for the industries given (tech hubs first for tech, finance hubs for finance). */
const HUBS: Record<string, { default: string[]; tech?: string[]; finance?: string[] }> = {
  in: { default: ["Bengaluru", "Mumbai", "Gurugram", "Pune", "Hyderabad"], tech: ["Bengaluru", "Hyderabad", "Pune", "Gurugram", "Noida"], finance: ["Mumbai", "Gurugram", "Bengaluru", "Chennai"] },
  sg: { default: ["Singapore"] },
  au: { default: ["Sydney", "Melbourne", "Brisbane", "Perth"], finance: ["Sydney", "Melbourne"] },
  ca: { default: ["Toronto", "Vancouver", "Montreal", "Calgary"], tech: ["Toronto", "Vancouver", "Montreal", "Waterloo"], finance: ["Toronto", "Montreal", "Vancouver"] },
  us: { default: ["New York", "San Francisco Bay Area", "Chicago", "Austin", "Boston"], tech: ["San Francisco Bay Area", "Seattle", "New York", "Austin", "Boston"], finance: ["New York", "Charlotte", "Chicago", "San Francisco"] },
  ae: { default: ["Dubai", "Abu Dhabi"], finance: ["Dubai", "Abu Dhabi"] },
  gb: { default: ["London", "Manchester", "Edinburgh", "Birmingham"], finance: ["London", "Edinburgh", "Manchester"] },
  ie: { default: ["Dublin", "Cork"] },
  de: { default: ["Berlin", "Munich", "Frankfurt", "Hamburg"], tech: ["Berlin", "Munich", "Hamburg"], finance: ["Frankfurt", "Munich"] },
  nl: { default: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"] },
  fr: { default: ["Paris", "Lyon", "Toulouse"] },
  ch: { default: ["Zurich", "Geneva", "Basel"] },
  nz: { default: ["Auckland", "Wellington"] },
  hk: { default: ["Hong Kong"] },
  my: { default: ["Kuala Lumpur", "Penang"] },
  qa: { default: ["Doha"] },
  sa: { default: ["Riyadh", "Jeddah"] },
  jp: { default: ["Tokyo", "Osaka"] },
  za: { default: ["Johannesburg", "Cape Town"] },
  se: { default: ["Stockholm", "Gothenburg"] },
  es: { default: ["Madrid", "Barcelona"] },
  it: { default: ["Milan", "Rome"] },
};

export function topLocations(country: string, industries: string[]): string[] {
  const h = HUBS[country.toLowerCase()];
  if (!h) return [];
  const tech = industries.some((i) => TECH.test(i)), fin = industries.some((i) => FINANCE.test(i));
  return (fin && !tech ? h.finance : tech ? h.tech : undefined) ?? h.default;
}
