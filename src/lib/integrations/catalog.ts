/**
 * What the system can connect to, stated honestly. An INTEGRATION is how listings reach us (an API, a feed, an
 * email box, manual entry). A PORTAL is where a listing lives (LinkedIn, Indeed, Naukri ...). Several portals
 * are reachable only through an integration that reads *published* listings: this app never logs in to or
 * scrapes LinkedIn, Indeed or Glassdoor, which have no open job-search or apply API for individuals and forbid it.
 */

export type IntegrationId = "adzuna" | "jsearch" | "remotive" | "arbeitnow" | "remoteok" | "jobicy" | "greenhouse" | "lever" | "manual" | "mailbox";
export type ApplyMode = "automated" | "assisted" | "none";

export type CredentialDef = { key: string; label: string; help: string; env?: string; /** not needed for the integration to be ready */ optional?: boolean };

export type IntegrationDef = {
  id: IntegrationId;
  name: string;
  kind: "aggregator API" | "company job-board API" | "email" | "manual";
  summary: string;
  available: boolean;                    // false = planned, shown but cannot be enabled yet
  credentials: CredentialDef[];          // all must be present before scanning
  needsConfig?: "greenhouse_boards" | "lever_companies"; // list kept in Settings > Job discovery
  discovers: boolean;
  apply: ApplyMode;                      // what this integration's listings support
  countries: "all" | string[];
  setup: string[];
  limitations: string[];
};

export const ADZUNA_COUNTRIES = ["at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "gb", "in", "it", "mx", "nl", "nz", "pl", "sg", "us", "za"];

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "adzuna", name: "Adzuna", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Job aggregator with an official free API covering India, the UK, the US, Australia, Singapore and more.",
    credentials: [
      { key: "app_id", label: "Application ID", help: "From developer.adzuna.com (free)", env: "ADZUNA_APP_ID" },
      { key: "app_key", label: "Application key", help: "From the same page", env: "ADZUNA_APP_KEY" },
    ],
    countries: ADZUNA_COUNTRIES,
    setup: ["Create a free account at developer.adzuna.com", "Copy the Application ID and key into Connect below", "Press Test"],
    limitations: [
      "One page (up to 30 jobs) per role and country per scan",
      "Links lead to the employer or another job board, so applying is assisted (you submit)",
      "Free plans have request limits; check your Adzuna plan",
    ],
  },
  {
    id: "jsearch", name: "JSearch (Google for Jobs)", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Aggregates listings published on LinkedIn, Indeed, Glassdoor, Naukri and many other sites. The publisher is recorded as each job's origin portal.",
    credentials: [{ key: "rapidapi_key", label: "RapidAPI key", help: "Subscribe to JSearch on rapidapi.com (a free plan exists)", env: "RAPIDAPI_KEY" }],
    countries: "all",
    setup: ["Create a RapidAPI account and subscribe to the JSearch API", "Copy your RapidAPI key into Connect below", "Press Test"],
    limitations: [
      "Read-only: it finds published listings; it does not log in to any portal",
      "Coverage of each portal varies by country and role",
      "The free plan has a small monthly request quota; each scan uses requests",
    ],
  },
  {
    id: "remotive", name: "Remotive", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Public feed of remote jobs. No account needed.",
    credentials: [], countries: "all",
    setup: ["Nothing to set up", "Press Test to confirm it is reachable"],
    limitations: ["Remote roles only", "No country filter: the country is guessed from the location text", "Applying is on the employer's site (assisted)"],
  },
  {
    id: "arbeitnow", name: "Arbeitnow", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Free public job board feed, strongest for Germany and the rest of Europe (including visa-sponsorship and relocation roles). No account needed.",
    credentials: [], countries: ["de", "nl", "at", "ch", "fr", "es", "pl", "ie", "gb"],
    setup: ["Nothing to set up", "Press Test to confirm it is reachable"],
    limitations: ["The feed has no search: it is fetched and filtered by your job titles here", "Mostly Europe; the country comes from the location text", "Applying is on the employer's site (assisted)"],
  },
  {
    id: "remoteok", name: "Remote OK", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Free public feed of remote jobs, many with salary ranges. No account needed.",
    credentials: [], countries: "all",
    setup: ["Nothing to set up", "Press Test to confirm it is reachable"],
    limitations: ["Remote roles only, filtered by your job titles here", "Remote OK asks that listings link back to remoteok.com; each job keeps its original link", "Applying is on the employer's site (assisted)"],
  },
  {
    id: "jobicy", name: "Jobicy", kind: "aggregator API", available: true, discovers: true, apply: "assisted",
    summary: "Free public feed of remote jobs worldwide with salary data on many. No account needed.",
    credentials: [], countries: "all",
    setup: ["Nothing to set up", "Press Test to confirm it is reachable"],
    limitations: ["Remote roles only, filtered by your job titles here", "Applying is on the employer's site (assisted)"],
  },
  {
    id: "greenhouse", name: "Greenhouse company boards", kind: "company job-board API", available: true, discovers: true, apply: "automated", needsConfig: "greenhouse_boards",
    summary: "Public job boards of companies that use Greenhouse. The one place where automatic applying is supported.",
    credentials: [], countries: "all",
    setup: ["Settings > Job discovery > Greenhouse boards: add the board token from a company's careers URL (boards.greenhouse.io/TOKEN)", "Press Test"],
    limitations: [
      "Only the companies you list",
      "Automatic applying fills standard forms; any required question you have not answered stops it and hands the job back to you",
      "CAPTCHAs and consent boxes are never bypassed",
    ],
  },
  {
    id: "lever", name: "Lever company boards", kind: "company job-board API", available: true, discovers: true, apply: "automated", needsConfig: "lever_companies",
    summary: "Public job boards of companies that use Lever. Automatic applying is supported on standard forms.",
    credentials: [], countries: "all",
    setup: ["Settings > Job discovery > Lever companies: add the company slug (jobs.lever.co/SLUG)", "Press Test"],
    limitations: ["Only the companies you list", "Required questions without a saved answer hand the job back to you", "CAPTCHAs are never bypassed"],
  },
  {
    id: "manual", name: "Added manually", kind: "manual", available: true, discovers: false, apply: "assisted",
    summary: "Paste a link and description for any posting, from any portal or an alert email.",
    credentials: [], countries: "all",
    setup: ["Review queue > Add job manually"],
    limitations: ["You supply the posting; nothing is fetched automatically"],
  },
  {
    id: "mailbox", name: "Job-alert emails", kind: "email", available: true, discovers: true, apply: "assisted",
    summary: "Reads the job-alert emails that LinkedIn, Indeed, Glassdoor and Naukri already send you (read-only IMAP) and turns each listed job into a job here. This is the compliant route to those portals: nothing logs in to them.",
    credentials: [
      { key: "imap_host", label: "IMAP server", help: "e.g. imap.gmail.com or outlook.office365.com", env: "IMAP_HOST" },
      { key: "imap_user", label: "Email address", help: "The mailbox that receives the alerts", env: "IMAP_USER" },
      { key: "imap_password", label: "App password", help: "An app password, not your normal password", env: "IMAP_PASSWORD" },
      { key: "imap_folder", label: "Folder (optional)", help: "Default INBOX. A label such as Job-alerts keeps scans small", optional: true },
      { key: "imap_port", label: "Port (optional)", help: "Default 993 (TLS)", optional: true },
    ],
    countries: "all",
    setup: [
      "Turn on the alerts you want in LinkedIn, Indeed, Glassdoor and Naukri (they email you matches)",
      "Gmail: turn on 2-step verification, create an App password, and make sure IMAP is enabled. Outlook/Microsoft 365: create an app password if your tenant allows IMAP",
      "Optional: add a filter that labels those emails (for example Job-alerts) and enter that folder name below",
      "Enter the server, address and app password, then press Test",
    ],
    limitations: [
      "Read-only: the app never changes, moves or deletes your email",
      "Alert emails contain a title, company and location, not the full description. Open the job and paste the description before preparing an application",
      "Email layouts change; if a portal's alerts stop producing jobs, Test shows what was found",
      "Only mail from the portals' own domains is read",
    ],
  },
];

export const integrationById = (id: string) => INTEGRATIONS.find((i) => i.id === id);

export type PortalDef = {
  key: string;
  name: string;
  via: IntegrationId[];                   // integrations that can surface this portal's listings
  apply: ApplyMode;
  applyNote: string;
  limitations: string[];
};

export const PORTALS: PortalDef[] = [
  {
    key: "linkedin", name: "LinkedIn", via: ["jsearch", "mailbox", "manual"], apply: "assisted",
    applyNote: "You press submit. Easy Apply automation is opt-in in Settings, capped, and at your own account risk.",
    limitations: ["LinkedIn has no open job-search or application API for individuals, and forbids scraping and automated applying", "Listings reach you through an aggregator feed, alert emails or manual entry; this app never logs in to LinkedIn to read jobs"],
  },
  {
    key: "indeed", name: "Indeed", via: ["jsearch", "mailbox", "manual"], apply: "assisted",
    applyNote: "Prepared for you; you submit on Indeed.",
    limitations: ["No open API for individuals; its terms forbid scraping", "Listings come through an aggregator feed, alert emails or manual entry"],
  },
  {
    key: "glassdoor", name: "Glassdoor", via: ["jsearch", "mailbox", "manual"], apply: "assisted",
    applyNote: "Prepared for you; you submit on Glassdoor.",
    limitations: ["Its job API is closed to new users; its terms forbid scraping", "Listings come through an aggregator feed, alert emails or manual entry"],
  },
  {
    key: "naukri", name: "Naukri", via: ["jsearch", "mailbox", "manual"], apply: "assisted",
    applyNote: "Login-gated; prepared for you and you submit.",
    limitations: ["No public API", "Coverage through aggregators varies; alert emails and manual add are the reliable routes"],
  },
  {
    key: "foundit", name: "Foundit (Monster India)", via: ["mailbox", "manual", "jsearch"], apply: "assisted",
    applyNote: "Login-gated; prepared for you and you submit.", limitations: ["No public API"],
  },
  {
    key: "shine", name: "Shine", via: ["mailbox", "manual"], apply: "assisted",
    applyNote: "Login-gated; prepared for you and you submit.", limitations: ["No public API"],
  },
  {
    key: "greenhouse", name: "Company career pages (Greenhouse)", via: ["greenhouse"], apply: "automated",
    applyNote: "Submitted by the worker when you approve (or automatically if your schedule allows it).",
    limitations: ["Only the companies you list", "Unusual forms are handed back to you"],
  },
  {
    key: "lever", name: "Company career pages (Lever)", via: ["lever"], apply: "automated",
    applyNote: "Submitted by the worker when you approve (or automatically if your schedule allows it).",
    limitations: ["Only the companies you list", "Unusual forms are handed back to you"],
  },
  { key: "adzuna", name: "Adzuna", via: ["adzuna"], apply: "assisted", applyNote: "Links go to the employer; you submit.", limitations: ["Aggregator: the true origin site is not always known"] },
  { key: "remotive", name: "Remotive", via: ["remotive"], apply: "assisted", applyNote: "Links go to the employer; you submit.", limitations: ["Remote roles only"] },
];

// --------------------------------------------------------------------------- status

export type IntegrationState = {
  enabled: boolean;
  last_scan_at?: string | null;
  last_ok_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_message?: string | null;
};

export type ConnectionStatus = "ok" | "error" | "ready" | "needs_setup" | "disabled" | "planned";

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  ok: "Working", error: "Problem", ready: "Ready (not yet scanned)", needs_setup: "Needs setup", disabled: "Disabled", planned: "Planned",
};

/**
 * Status shown to the user, derived from facts rather than stored: setup first, then the most recent evidence.
 * "Working" requires an actual successful scan or test, never just configuration.
 */
export function deriveStatus(def: IntegrationDef, state: IntegrationState | undefined, hasCredentials: boolean, hasConfig = true): ConnectionStatus {
  if (!def.available) return "planned";
  if (state && state.enabled === false) return "disabled";
  if ((def.credentials.length > 0 && !hasCredentials) || (def.needsConfig && !hasConfig)) return "needs_setup";
  if (!state) return def.id === "manual" ? "ok" : "ready";
  const t = (s?: string | null) => (s ? new Date(s).getTime() : 0);
  const lastGood = Math.max(t(state.last_ok_at), state.last_test_ok ? t(state.last_test_at) : 0);
  const lastBad = Math.max(t(state.last_error_at), state.last_test_ok === false ? t(state.last_test_at) : 0);
  if (lastBad > lastGood) return "error";
  if (lastGood > 0) return "ok";
  return def.id === "manual" ? "ok" : "ready";
}

/** A portal's status is the best status among the integrations that can surface it. */
export function derivePortalStatus(portal: PortalDef, statusOf: (id: IntegrationId) => ConnectionStatus, jobsSeen: number): { status: ConnectionStatus; note: string } {
  const order: ConnectionStatus[] = ["ok", "ready", "error", "needs_setup", "disabled", "planned"];
  const usable = portal.via.map((id) => ({ id, s: statusOf(id) }));
  const best = usable.map((u) => u.s).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "needs_setup";
  const working = usable.filter((u) => u.s === "ok").map((u) => integrationById(u.id)?.name).filter(Boolean);
  const note = best === "ok"
    ? `Receiving jobs via ${working.join(", ")}`
    : jobsSeen > 0 ? `${jobsSeen} job${jobsSeen === 1 ? "" : "s"} seen earlier; no connection is working now` : best === "ready" ? "Connected, nothing scanned yet" : best === "error" ? "Its connection has a problem" : "Not connected: set up one of the routes below";
  return { status: best, note };
}

/** Turns an HTTP failure into a message that says what to do. */
export function explainHttpFailure(status: number, host: string): string {
  if (status === 401 || status === 403) return `${host} rejected the credentials (HTTP ${status}). Check the key and that your plan is active.`;
  if (status === 404) return `${host} returned "not found" (HTTP 404). The endpoint, board token or company name may be wrong.`;
  if (status === 429) return `${host} says the request quota or rate limit is used up (HTTP 429). Wait or upgrade the plan.`;
  if (status >= 500) return `${host} is having problems (HTTP ${status}). Try again later.`;
  return `${host} returned HTTP ${status}.`;
}
