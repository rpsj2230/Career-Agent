/** Countries the app knows, with the currency salaries are normally quoted in there. `adzuna` marks API coverage. */
export type CountryInfo = { code: string; name: string; currency: string; adzuna: boolean };

export const COUNTRIES: CountryInfo[] = [
  { code: "in", name: "India", currency: "INR", adzuna: true },
  { code: "sg", name: "Singapore", currency: "SGD", adzuna: true },
  { code: "ae", name: "United Arab Emirates", currency: "AED", adzuna: false },
  { code: "au", name: "Australia", currency: "AUD", adzuna: true },
  { code: "nz", name: "New Zealand", currency: "NZD", adzuna: true },
  { code: "gb", name: "United Kingdom", currency: "GBP", adzuna: true },
  { code: "ie", name: "Ireland", currency: "EUR", adzuna: false },
  { code: "us", name: "United States", currency: "USD", adzuna: true },
  { code: "ca", name: "Canada", currency: "CAD", adzuna: true },
  { code: "de", name: "Germany", currency: "EUR", adzuna: true },
  { code: "nl", name: "Netherlands", currency: "EUR", adzuna: true },
  { code: "fr", name: "France", currency: "EUR", adzuna: true },
  { code: "es", name: "Spain", currency: "EUR", adzuna: true },
  { code: "it", name: "Italy", currency: "EUR", adzuna: true },
  { code: "ch", name: "Switzerland", currency: "CHF", adzuna: true },
  { code: "at", name: "Austria", currency: "EUR", adzuna: true },
  { code: "be", name: "Belgium", currency: "EUR", adzuna: true },
  { code: "pl", name: "Poland", currency: "PLN", adzuna: true },
  { code: "za", name: "South Africa", currency: "ZAR", adzuna: true },
  { code: "br", name: "Brazil", currency: "BRL", adzuna: true },
  { code: "mx", name: "Mexico", currency: "MXN", adzuna: true },
  { code: "hk", name: "Hong Kong", currency: "HKD", adzuna: false },
  { code: "my", name: "Malaysia", currency: "MYR", adzuna: false },
  { code: "jp", name: "Japan", currency: "JPY", adzuna: false },
  { code: "qa", name: "Qatar", currency: "QAR", adzuna: false },
  { code: "sa", name: "Saudi Arabia", currency: "SAR", adzuna: false },
  { code: "id", name: "Indonesia", currency: "IDR", adzuna: false },
  { code: "ph", name: "Philippines", currency: "PHP", adzuna: false },
  { code: "th", name: "Thailand", currency: "THB", adzuna: false },
  { code: "vn", name: "Vietnam", currency: "VND", adzuna: false },
];

export const countryInfo = (code: string | null | undefined) => COUNTRIES.find((c) => c.code === code?.toLowerCase());
export const defaultCurrency = (code: string | null | undefined) => countryInfo(code)?.currency;
export const COUNTRY_NAME_MAP: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
