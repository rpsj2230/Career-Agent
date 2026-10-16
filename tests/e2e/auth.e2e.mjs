// End-to-end: real built Next app + mock Supabase. Run with: npm run build && npm run test:e2e
import { spawn } from "node:child_process";
import { startMock } from "./mock-supabase.mjs";

const MOCK = 4010, APP = 4011, BASE = `http://127.0.0.1:${APP}`;
const SECRET = "e2e-cron-secret-0123456789";
const mock = await startMock(MOCK);

const next = spawn("node_modules/.bin/next", ["start", "-p", String(APP)], {
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: SECRET, ALLOWED_EMAILS: "", E2E_MOCK_URL: `http://127.0.0.1:${MOCK}`, NODE_OPTIONS: "--require ./tests/e2e/redirect-fetch.cjs" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; next.stdout.on("data", (d) => (log += d)); next.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function call(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && jar.size ? { Cookie: cookieHeader() } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split(";"); const i = pair.indexOf("="); const name = pair.slice(0, i), value = pair.slice(i + 1);
    const gone = attrs.some((a) => /max-age=0/i.test(a) || /expires=.*1970/i.test(a)) || value === "";
    if (gone) jar.delete(name); else jar.set(name, value);
  }
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.getSetCookie(), json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text };
}

let failed = 0;
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`); };

const PW = "correct horse battery";
let r;
r = await call("/", { auth: false });             check("signed-out page redirects to /login", r.status === 307 && r.location?.endsWith("/login"), `${r.status} ${r.location}`);
r = await call("/api/files?path=x", { auth: false }); check("signed-out API gets 401", r.status === 401, r.status);
r = await call("/api/auth/signup", { method: "POST", body: { email: "me@x.com", password: PW, code: "wrong" } }); check("sign-up with wrong invite code refused", r.status === 403, r.status);
r = await call("/api/auth/signup", { method: "POST", body: { email: "me@x.com", password: "short", code: SECRET } }); check("sign-up with weak password refused", r.status === 400, r.status);
r = await call("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: PW } }); check("login before any account exists fails", r.status === 401, r.status);

r = await call("/api/auth/signup", { method: "POST", body: { email: "Me@X.com", password: PW, code: SECRET } }); check("first sign-up (right code) creates the owner", r.status === 200 && mock.settings.get("owner")?.email === "me@x.com", `${r.status} ${r.text}`);
r = await call("/api/auth/signup", { method: "POST", body: { email: "intruder@x.com", password: PW, code: SECRET } }); check("second person cannot register (owner already claimed)", r.status === 403 && !mock.users.has("intruder@x.com"), `${r.status} ${r.text}`);
r = await call("/api/auth/signup", { method: "POST", body: { email: "me@x.com", password: PW, code: SECRET } }); check("owner re-registering is told to sign in", r.status === 409, `${r.status} ${r.text}`);

r = await call("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: "wrong password!!" } }); check("login with wrong password -> 401, no cookie", r.status === 401 && jar.size === 0, `${r.status} cookies=${jar.size}`);
r = await call("/api/auth/login", { method: "POST", body: { email: "ME@x.com", password: PW } });
check("owner login succeeds and sets a session cookie", r.status === 200 && jar.size > 0, `${r.status} ${r.text}`);
check("session cookie is httpOnly", r.setCookie.length > 0 && r.setCookie.every((c) => /httponly/i.test(c)), r.setCookie.join(" | "));

r = await call("/api/files?path=bad"); check("signed-in request passes the gate (400 from the route's own validation)", r.status === 400, `${r.status} ${r.text}`);
r = await call("/login"); check("login page still reachable while signed in", r.status === 200, r.status);

// a second real Supabase user who is NOT the owner
mock.users.set("stranger@x.com", { id: "u99", email: "stranger@x.com", password: PW });
const saved = new Map(jar); jar.clear();
r = await call("/api/auth/login", { method: "POST", body: { email: "stranger@x.com", password: PW } }); check("valid Supabase user who is not the owner is refused (403)", r.status === 403, `${r.status} ${r.text}`);
r = await call("/api/files?path=bad"); check("...and gets no access afterwards", r.status === 401, r.status);

jar.clear(); for (const [k, v] of saved) jar.set(k, v);
r = await call("/api/files?path=bad"); check("owner session still works", r.status === 400, r.status);

// ---- database behind the code: banner and System page tell you exactly what to do, then clear once applied
r = await call("/system?fresh=1");
check("System page lists the pending migration with copyable SQL", r.status === 200 && r.text.includes("0002_portals_runs_logs_schedules") && r.text.includes("Copy SQL") && r.text.includes("create table if not exists integrations"), `${r.status}`);
check("banner appears on app pages while the database is behind", r.text.includes("Database update needed"), "banner missing");
check("System page names the missing tables and columns", r.text.includes("activity_log") && /missing columns: [^<]*portal/.test(r.text), "details missing");

// ---- discovery while the database is still behind: jobs still arrive (without new columns) and nothing crashes
const DISC = { countries: ["sg"], roles: ["Product Manager"], greenhouse_boards: [], lever_companies: [], max_age_days: 30 };
r = await call("/api/settings", { method: "PUT", body: { key: "discovery", value: DISC } }); check("discovery settings saved", r.status === 200, `${r.status} ${r.text}`);
r = await call("/api/integrations/adzuna/credentials", { method: "PUT", body: { values: { app_id: "ADZ-ID-123", app_key: "ADZ-KEY-456" } } });
check("Adzuna credentials saved without being echoed", r.status === 200 && !r.text.includes("ADZ-KEY-456"), `${r.status} ${r.text}`);
const storedKeys = JSON.stringify(mock.settings.get("integration_keys") ?? {});
check("credentials are encrypted at rest", storedKeys.includes("adzuna.app_id") && !storedKeys.includes("ADZ-ID-123") && !storedKeys.includes("ADZ-KEY-456"), storedKeys);
r = await call("/api/integrations/adzuna/scan", { method: "POST" });
check("scan before the migration still succeeds", r.status === 200 && /2 jobs fetched, 2 new/.test(r.text), `${r.status} ${r.text}`);
check("legacy insert left out the new columns instead of failing", mock.rowsOf("jobs").length === 2 && mock.rowsOf("jobs").every((j) => j.portal === undefined), JSON.stringify(mock.rowsOf("jobs").map((j) => Object.keys(j))));
check("the external API received the decrypted credentials", mock.seen.external.some((e) => e.host === "api.adzuna.com" && e.query.app_id === "ADZ-ID-123" && e.query.app_key === "ADZ-KEY-456"), JSON.stringify(mock.seen.external.at(-1)));
r = await call("/portals"); check("Portals page renders while the database is behind and says so", r.status === 200 && r.text.includes("Database update needed"), `${r.status}`);

mock.applyMigration2();
r = await call("/api/system/recheck", { method: "POST" }); check("Re-check endpoint reports the database is now healthy", r.status === 200 && r.json?.ok === true, `${r.status} ${r.text}`);
r = await call("/system");
check("after the migration is applied, a re-check reports up to date", r.status === 200 && r.text.includes("up to date") && !r.text.includes("Database update needed"), `${r.status} upToDate=${r.text.includes("up to date")} banner=${r.text.includes("Database update needed")} check_failed=${r.text.includes("check failed")} snippet=${(r.text.match(/Database[^<]{0,40}<[^>]*>[^<]{0,60}/g) ?? []).slice(0, 3).join(" | ")}`);

// ---- portals, scans, runs and the activity log once the database is up to date
mock.fixtures.adzunaResults = [...mock.fixtures.adzunaResults, { id: 103, title: "Principal Product Manager", company: { display_name: "Gamma Pte Ltd" }, location: { display_name: "Singapore" }, redirect_url: "https://www.adzuna.sg/land/ad/103", description: "Shape the strategy. ".repeat(8), created: new Date().toISOString() }];
r = await call("/api/integrations/adzuna/test", { method: "POST" });
check("Test passes with the saved credentials and is recorded", r.status === 200 && /accepted the credentials/.test(r.text) && mock.rowsOf("integrations").find((i) => i.id === "adzuna")?.last_test_ok === true, `${r.status} ${r.text}`);
r = await call("/api/integrations/adzuna/scan", { method: "POST" });
check("scan reports new vs already-known jobs", r.status === 200 && /3 jobs fetched, 1 new, 2 already known/.test(r.text), `${r.status} ${r.text}`);
const newJob = mock.rowsOf("jobs").find((j) => j.external_id === "103");
check("new jobs carry their originating portal, scan and run", newJob?.portal === "adzuna" && !!newJob.scan_id && !!newJob.run_id, JSON.stringify(newJob));
const run = mock.rowsOf("automation_runs").at(-1);
check("the run is recorded as succeeded with counters and a finish time", run?.status === "succeeded" && run.stats.inserted === 1 && run.stats.fetched === 3 && !!run.finished_at, JSON.stringify(run));
const scan = mock.rowsOf("portal_scans").at(-1);
check("the scan is stored with its counts", scan?.status === "ok" && scan.fetched === 3 && scan.inserted === 1 && scan.duplicates === 2 && scan.country === "sg" && scan.query === "Product Manager", JSON.stringify(scan));
const kinds = mock.rowsOf("activity_log").filter((l) => l.run_id === run.id).map((l) => l.kind);
check("the activity log has the run and scan events", kinds.includes("run.started") && kinds.includes("scan.finished") && kinds.includes("run.finished"), kinds.join(","));
check("integration state shows a working Adzuna with a running total", mock.rowsOf("integrations").find((i) => i.id === "adzuna")?.status === "ok" && mock.rowsOf("integrations").find((i) => i.id === "adzuna")?.jobs_found_total === 1, JSON.stringify(mock.rowsOf("integrations")));
r = await call("/portals"); check("Portals page shows Adzuna as Working with recent scans and limits", r.status === 200 && r.text.includes("Working") && r.text.includes("Recent scans") && r.text.includes("Limits"), `${r.status}`);

// a failing source: recorded, explained, and visible
mock.fixtures.failHosts.add("api.adzuna.com");
r = await call("/api/integrations/adzuna/test", { method: "POST" }); check("a failing test explains what happened", r.status === 422 && /quota or rate limit/.test(r.text), `${r.status} ${r.text}`);
r = await call("/api/integrations/adzuna/scan", { method: "POST" }); check("a fully failing scan reports the error instead of success", r.status === 422 && /429|quota/.test(r.text), `${r.status} ${r.text}`);
check("the failed scan and its reason are persisted (not lost)", mock.rowsOf("portal_scans").at(-1)?.status === "error" && /quota/.test(mock.rowsOf("portal_scans").at(-1)?.error ?? ""), JSON.stringify(mock.rowsOf("portal_scans").at(-1)));
check("the failed run is marked partial with the reason", mock.rowsOf("automation_runs").at(-1)?.status === "partial" && /scans failed/.test(mock.rowsOf("automation_runs").at(-1)?.error ?? ""), JSON.stringify(mock.rowsOf("automation_runs").at(-1)));
check("the error is in the activity log with the integration", mock.rowsOf("activity_log").some((l) => l.kind === "scan.failed" && l.level === "error" && l.integration === "adzuna"), "no scan.failed row");
r = await call("/portals"); check("Portals page shows the problem and the last error", r.text.includes("Problem") && /quota or rate limit/.test(r.text), "page lacks the error");
mock.fixtures.failHosts.delete("api.adzuna.com");
r = await call("/api/integrations/adzuna/scan", { method: "POST" }); r = await call("/portals");
check("after the source recovers, the status returns to Working and the Problem badge is gone", r.text.includes("Working") && !r.text.includes("Problem"), `working=${r.text.includes("Working")} problem=${r.text.includes("Problem")}`);

// origin portal from an aggregator's publisher
r = await call("/api/integrations/jsearch/credentials", { method: "PUT", body: { values: { rapidapi_key: "RAPID-KEY-789" } } }); check("JSearch key saved", r.status === 200, r.status);
r = await call("/api/integrations/jsearch/scan", { method: "POST" }); check("JSearch scan succeeds", r.status === 200 && /1 new/.test(r.text), `${r.status} ${r.text}`);
const js = mock.rowsOf("jobs").find((j) => j.external_id === "js1");
check("the job's origin portal is the publisher (LinkedIn), not the employer link or the API", js?.portal === "linkedin" && js.source.startsWith("jsearch"), JSON.stringify(js));
check("JSearch received the key in the header", mock.seen.external.some((e) => e.host === "jsearch.p.rapidapi.com" && e.key === "RAPID-KEY-789"), "key not seen");

// ---- Jobs list: origin portal shown, filters in the URL, hostile input ignored
r = await call("/jobs?view=all"); check("Jobs list shows every stored job with its source", r.status === 200 && r.text.includes("Principal Product Manager") && r.text.includes("Gamma Pte Ltd") && r.text.includes("Delta"), `${r.status}`);
check("the Source column names the origin portals", r.text.includes("LinkedIn") && r.text.includes("Adzuna"), "portal labels missing");
check("the filter lists portals that actually exist, with counts", /<option value="linkedin">LinkedIn \(1\)/.test(r.text.replace(/<!-- -->/g, "")), "dropdown missing");
r = await call("/jobs?view=all&portal=linkedin"); check("portal filter shows only that portal's jobs", r.text.includes("Delta") && !r.text.includes("Gamma Pte Ltd"), "wrong rows");
r = await call("/jobs?view=all&country=in"); check("country filter with no matches says so", r.text.includes("Nothing here for these filters"), "empty state missing");
r = await call("/jobs?view=all&country=sg"); check("country filter keeps matching jobs", r.text.includes("Gamma Pte Ltd") && r.text.includes("Singapore"), "rows missing");
r = await call("/jobs?view=all&portal=x%27%3B%20delete&view2=1"); check("a hostile portal value is ignored, not executed", r.status === 200 && r.text.includes("Gamma Pte Ltd"), `${r.status}`);
r = await call("/jobs"); check("the default view is the review queue (nothing matched yet)", r.status === 200 && r.text.includes("Nothing here for these filters"), `${r.status}`);
r = await call("/applications"); check("Applications list renders with its filter bar", r.status === 200 && r.text.includes("Pending approval") && r.text.includes("All portals"), `${r.status}`);
r = await call("/api/export/applications?portal=linkedin&country=sg"); check("CSV export accepts the same filters", r.status === 200 && r.text.startsWith("company,title,country,portal,found_via"), `${r.status} ${r.text.slice(0, 80)}`);

// enable / disable and guard rails
r = await call("/api/integrations/adzuna", { method: "PUT", body: { enabled: false } }); check("an integration can be disabled", r.status === 200 && mock.rowsOf("integrations").find((i) => i.id === "adzuna")?.enabled === false, `${r.status} ${r.text}`);
r = await call("/api/integrations/adzuna/scan", { method: "POST" }); check("a disabled integration is not scanned", r.status === 200 && /Nothing to scan/.test(r.text), `${r.status} ${r.text}`);
r = await call("/portals"); check("Portals page shows it as Disabled", r.text.includes("Disabled"), "not shown");
await call("/api/integrations/adzuna", { method: "PUT", body: { enabled: true } });
r = await call("/api/integrations/nope/test", { method: "POST" }); check("an unknown integration is a 404", r.status === 404, r.status);
r = await call("/api/integrations/mailbox/test", { method: "POST" }); check("a planned integration is refused clearly", r.status === 409, r.status);
r = await call("/api/integrations/adzuna/credentials", { method: "PUT", body: { values: { app_id: "has space" } } }); check("credentials with spaces are rejected", r.status === 400, r.status);
r = await call("/api/integrations/adzuna/credentials", { method: "PUT", body: { values: { bogus: "abcdefgh" } } }); check("unknown credential fields are rejected", r.status === 400, r.status);
r = await call("/api/integrations/adzuna/credentials", { method: "DELETE" }); check("saved credentials can be removed", r.status === 200 && !JSON.stringify(mock.settings.get("integration_keys") ?? {}).includes("adzuna."), `${r.status}`);
r = await call("/api/integrations/adzuna/scan", { method: "POST" }); check("without credentials Adzuna is not scanned", /Nothing to scan/.test(r.text), r.text);

// ---- the whole pipeline: profile -> scoring decisions -> prepare -> approve -> submit, with everything logged
const PROFILE = { basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8000 0000", location: "Singapore", headline: "Product Manager", summary: "PM with 6 years", links: [] }, preferences: { countries: ["sg"], roles: ["Product Manager"] }, experience: [{ id: "exp1", company: "Acme", title: "Product Manager", start: "2020", end: "Present", bullets: [{ id: "exp1.b1", text: "Grew activation by 24%" }] }], education: [], skills: [{ id: "skill1", name: "SQL" }], certifications: [] };
r = await call("/api/profile/confirm", { method: "POST", body: PROFILE }); check("profile confirmed", r.status === 200, `${r.status} ${r.text}`);
const PIPE_KEY = "pipe-key-1234567890";
mock.modelConfigs.set("e2e-pipeline", { id: "m2", label: "e2e-pipeline", provider: "mock", base_url: `http://127.0.0.1:${MOCK}/v1`, model: "mock-2", api_key_env: "E2E_PIPE_KEY", tasks: ["score", "tailor", "extract"], priority: 0, daily_cap: null, enabled: true });
r = await call("/api/models/key", { method: "PUT", body: { label: "e2e-pipeline", apiKey: PIPE_KEY } }); check("pipeline model key saved", r.status === 200, r.status);
const longDesc = "Own the roadmap and partner with engineering. ".repeat(6);
r = await call("/api/jobs/manual", { method: "POST", body: { url: "https://www.naukri.com/job-listings-pm-zeta", title: "Product Manager", company: "Zeta Pte", description: longDesc, country: "sg" } }); check("manual add (Singapore, Naukri)", r.status === 200, `${r.status} ${r.text}`);
r = await call("/api/jobs/manual", { method: "POST", body: { url: "https://www.naukri.com/job-listings-pm-usco", title: "Product Manager", company: "US Co", description: longDesc, country: "us" } }); check("manual add (outside the target country)", r.status === 200, `${r.status} ${r.text}`);
check("the manual job's origin portal comes from its URL", mock.rowsOf("jobs").find((j) => j.company === "Zeta Pte")?.portal === "naukri", JSON.stringify(mock.rowsOf("jobs").find((j) => j.company === "Zeta Pte")));
r = await call("/api/cron/score?limit=40"); check("scoring runs", r.status === 200 && r.json?.scored >= 4, `${r.status} ${r.text}`);
const scoreRun = mock.rowsOf("automation_runs").filter((x) => x.kind === "score").at(-1);
check("scoring is a recorded run with counters", scoreRun?.status === "succeeded" && scoreRun.stats.matched >= 4 && scoreRun.stats.rejected >= 2, JSON.stringify(scoreRun));
const logs = () => mock.rowsOf("activity_log");
const usRej = logs().find((l) => l.kind === "job.rejected" && l.company === "US Co");
check("a country rejection is logged with its reason, portal and country", usRej?.detail?.stage === "prefilter" && /outside your target countries/.test(usRej.message) && usRej.country === "us" && usRej.portal === "naukri" && usRej.run_id === scoreRun.id, JSON.stringify(usRej));
const fitRej = logs().find((l) => l.kind === "job.rejected" && l.company === "Gamma Pte Ltd");
check("a fit rejection is logged with score, threshold and the model's reason", fitRej?.detail?.stage === "fit" && fitRej.detail.score === 40 && /below threshold 65/.test(fitRej.message) && /Too senior/.test(fitRej.message), JSON.stringify(fitRej));
const matched = logs().find((l) => l.kind === "job.matched" && l.company === "Zeta Pte");
check("a match is logged with its score and the matched skills", matched?.detail?.score === 82 && matched.detail.matchedSkills?.includes("SQL") && matched.status === "matched", JSON.stringify(matched));
const zeta = mock.rowsOf("jobs").find((j) => j.company === "Zeta Pte");
check("the job's status and decision time are saved", zeta?.status === "queued" && !!zeta.decided_at, JSON.stringify(zeta));
check("the rejected job keeps its reason on the job", /outside your target countries/.test(mock.rowsOf("jobs").find((j) => j.company === "US Co")?.skip_reason ?? ""), "no reason");
r = await call("/jobs?view=skipped"); check("the Rejected view shows why each job was rejected", r.text.includes("outside your target countries") && r.text.includes("below threshold"), `${r.status}`);

// prepare, approve (assisted: Naukri), submit
r = await call(`/api/jobs/${zeta.id}/prepare`, { method: "POST" }); check("prepare tailors a resume and cover letter", r.status === 200 && r.json?.verified === true, `${r.status} ${r.text}`);
const application = mock.rowsOf("applications").find((a) => a.job_id === zeta.id);
check("the application records its portal and country", application?.portal === "naukri" && application.country === "sg" && application.status === "prepared", JSON.stringify(application));
check("two documents were stored and uploaded", mock.rowsOf("documents").filter((d) => d.job_id === zeta.id).length === 2 && mock.seen.uploads.filter((u) => u.path.startsWith(zeta.id)).length === 2, JSON.stringify(mock.seen.uploads));
for (const kind of ["resume.generated", "cover.generated", "application.prepared"]) {
  const l = logs().find((x) => x.kind === kind && x.application_id === application.id);
  check(`${kind} is logged against the application, job, company, country and portal`, l?.job_id === zeta.id && l.company === "Zeta Pte" && l.country === "sg" && l.portal === "naukri", JSON.stringify(l));
}
r = await call(`/api/jobs/${zeta.id}/prepare`, { method: "POST" });
check("preparing the same job again does not create a second application (no duplicates)", r.status === 200 && mock.rowsOf("applications").filter((a) => a.job_id === zeta.id).length === 1, `${r.status}`);
r = await call(`/api/applications/${application.id}`, { method: "POST", body: { action: "approve" } }); check("approving a Naukri job is assisted", r.status === 200 && r.json?.mode === "assisted", `${r.status} ${r.text}`);
check("the approval is logged with its mode", logs().some((l) => l.kind === "application.approved" && l.application_id === application.id && l.detail?.mode === "assisted"), "missing");
r = await call(`/api/applications/${application.id}`, { method: "POST", body: { action: "approve" } }); check("a second approval is refused", r.status === 409, r.status);
r = await call(`/api/applications/${application.id}`, { method: "POST", body: { action: "mark_submitted" } }); check("marking it submitted works", r.status === 200 && mock.rowsOf("applications").find((a) => a.id === application.id)?.status === "submitted", `${r.status}`);
check("the submission is logged", logs().some((l) => l.kind === "application.submitted" && l.application_id === application.id && l.company === "Zeta Pte"), "missing");
check("the application timeline (apply_events) still records the steps", ["prepared", "approved", "marked_submitted"].every((k) => mock.rowsOf("apply_events").some((e) => e.application_id === application.id && e.kind === k)), JSON.stringify(mock.rowsOf("apply_events").map((e) => e.kind)));

// configuration and authentication events
r = await call("/api/settings", { method: "PUT", body: { key: "scoring", value: { threshold: 65 } } }); check("settings change", r.status === 200, r.status);
check("a configuration change is logged with what changed", logs().some((l) => l.kind === "config.changed" && l.detail?.key === "scoring" && l.detail?.value?.threshold === 65), "missing");
jar.clear();
r = await call("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: "not the password" } });
check("a failed sign-in is logged as a warning without the password", logs().some((l) => l.kind === "auth.login_failed" && l.level === "warn" && l.detail?.email === "me@x.com"), "missing");
r = await call("/api/auth/signup", { method: "POST", body: { email: "intruder2@x.com", password: PW, code: SECRET } });
check("a refused account creation is logged", logs().some((l) => l.kind === "auth.login_failed" && /already has an owner/.test(l.message)), "missing");
r = await call("/api/auth/login", { method: "POST", body: { email: "me@x.com", password: PW } });
check("a successful sign-in is logged", r.status === 200 && logs().some((l) => l.kind === "auth.login" && l.detail?.email === "me@x.com"), `${r.status}`);

// nothing secret in the log
const everything = JSON.stringify(logs());
for (const secret of ["ADZ-KEY-456", "ADZ-ID-123", "RAPID-KEY-789", PIPE_KEY, SECRET, PW, "not the password"]) check(`no secret in the activity log: ${secret.slice(0, 8)}...`, !everything.includes(secret), "FOUND");

// ---- Logs page: filters, deep links, pagination, runs and scans
const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
for (let i = 1; i <= 30; i++) mock.rowsOf("activity_log").push({ id: 100000 + i, at: new Date(Date.now() - i * 1000).toISOString(), level: "info", kind: "config.changed", message: `filler event ${i}`, detail: {}, run_id: null, scan_id: null, integration: null, portal: null, country: null, company: null, job_id: null, application_id: null, status: null });
check("enough events exist to test pagination", mock.rowsOf("activity_log").length > 50, `only ${mock.rowsOf("activity_log").length}`);
r = await call("/logs"); check("Logs page shows recent events across categories", r.status === 200 && r.text.includes("Activity log") && r.text.includes("job.rejected") && r.text.includes("application.submitted"), `${r.status}`);
check("rows link to their job and application", r.text.includes(`href="/jobs/${zeta.id}"`) && r.text.includes(`href="/applications/${application.id}"`), "links missing");
r = await call("/logs?level=error"); check("level filter shows errors only", r.text.includes("request quota") && !r.text.includes("Matched (fit"), "wrong rows");
r = await call("/logs?category=job"); check("type filter shows job events only", r.text.includes("Matched (fit") && r.text.includes("Rejected before scoring") && !r.text.includes("Marked as submitted by you"), "wrong rows");
r = await call("/logs?country=us"); check("country filter shows only that country", r.text.includes("US Co") && !r.text.includes("Zeta Pte"), "wrong rows");
r = await call("/logs?company=zeta"); check("company filter matches part of the name, case-insensitively", r.text.includes("Zeta Pte") && !r.text.includes("US Co"), "wrong rows");
r = await call("/logs?portal=naukri&status=rejected"); check("portal and status filters combine", r.text.includes("US Co") && !r.text.includes("Zeta Pte"), "wrong rows");
r = await call("/logs?q=outside+your+target"); check("text search finds the rejection reason", r.text.includes("US Co") && !r.text.includes("Zeta Pte"), "wrong rows");
r = await call(`/logs?run=${scoreRun.id}`); check("run filter shows what happened in that run", r.text.includes("Matched (fit") && r.text.includes("score run succeeded") && !r.text.includes("Application prepared for"), "wrong rows");
r = await call(`/logs?job=${zeta.id}`); check("job filter follows one job through its history", r.text.includes("Matched (fit") && r.text.includes("Application prepared for") && !r.text.includes("US Co") && !r.text.includes("Gamma Pte"), "wrong rows");
r = await call(`/logs?from=${istToday}&to=${istToday}`); check("a date range in the display time zone includes today's events", r.text.includes("job.matched"), "missing");
r = await call("/logs?from=2020-01-01&to=2020-01-02"); check("a date range with no activity says so", r.text.includes("No activity matches these filters"), "empty state missing");
r = await call("/logs?level=bogus&portal=x%27%3B&company=%29%2Cid.neq.0&page=-5"); check("hostile filter values are ignored safely", r.status === 200 && r.text.includes("job.matched"), `${r.status}`);
r = await call("/logs?page=2"); check("pagination works and offers a way back", r.status === 200 && r.text.includes("page 2 of") && r.text.includes("Newer"), `${r.status}`);

r = await call("/logs/runs"); check("Runs page lists runs with outcomes and totals per source", r.status === 200 && r.text.includes("Jobs found per source") && r.text.includes("succeeded") && r.text.includes("partial") && r.text.includes("Adzuna"), `${r.status}`);
const scanRun = mock.rowsOf("automation_runs").find((x) => x.kind === "scan" && x.stats?.inserted === 1);
r = await call(`/logs/runs/${scanRun.id}`); check("a run page shows its counters, scans and log entries", r.status === 200 && r.text.includes("Scans in this run") && r.text.includes("already known") && r.text.includes("scan.finished"), `${r.status}`);
const badRun = mock.rowsOf("automation_runs").find((x) => x.status === "partial");
r = await call(`/logs/runs/${badRun.id}`); check("a partial run explains what went wrong", r.text.includes("What went wrong") && /scans failed|quota/.test(r.text), "reason missing");
r = await call("/logs/runs/not-a-uuid"); check("an invalid run id is a 404", r.status === 404, r.status);

// ---- models: saved keys are encrypted at rest, used for calls, and removable
const KEY = "sk-test-key-1234567890";
mock.modelConfigs.set("e2e-model", { id: "m1", label: "e2e-model", provider: "mock", base_url: `http://127.0.0.1:${MOCK}/v1`, model: "mock-1", api_key_env: "E2E_KEY", tasks: ["score"], priority: 1, daily_cap: null, enabled: true });
r = await call("/api/models/test", { method: "POST", body: { label: "e2e-model" } }); check("test without any key is refused with a clear message", r.status === 422 && /No key yet/.test(r.text), `${r.status} ${r.text}`);
r = await call("/api/models/key", { method: "PUT", body: { label: "e2e-model", apiKey: "has spaces in it" } }); check("a key containing spaces is rejected", r.status === 400, `${r.status} ${r.text}`);
r = await call("/api/models/key", { method: "PUT", body: { label: "nope", apiKey: KEY } }); check("saving a key for an unknown model is refused", r.status === 404, r.status);
r = await call("/api/models/key", { method: "PUT", body: { label: "e2e-model", apiKey: KEY } }); check("saving a key works", r.status === 200, `${r.status} ${r.text}`);
const stored = JSON.stringify(mock.settings.get("model_keys") ?? {});
check("the key is stored encrypted, not as plaintext", stored.includes("e2e-model") && !stored.includes(KEY) && /v1\./.test(stored), stored);
check("no endpoint echoes the key back", !r.text.includes(KEY));
r = await call("/api/models/test", { method: "POST", body: { label: "e2e-model" } }); check("model test succeeds using the saved key", r.status === 200 && /works/.test(r.text), `${r.status} ${r.text}`);
check("the provider received the decrypted key as a bearer token", mock.seen.lastChatAuth === `Bearer ${KEY}`, String(mock.seen.lastChatAuth));
r = await call("/api/models/key?label=e2e-model", { method: "DELETE" }); check("removing the saved key works", r.status === 200, r.status);
r = await call("/api/models/test", { method: "POST", body: { label: "e2e-model" } }); check("after removal the test is refused again", r.status === 422, r.status);
r = await call("/api/auth/logout", { method: "POST" }); check("logout succeeds and clears cookies", r.status === 200 && jar.size === 0, `${r.status} cookies=${jar.size}`);
r = await call("/api/files?path=bad"); check("after logout the API is closed again", r.status === 401, r.status);
r = await call("/api/models/key", { method: "PUT", body: { label: "e2e-model", apiKey: KEY } }); check("after logout nobody can save keys", r.status === 401, r.status);
r = await call("/api/cron/score", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } }); check("cron bearer token still passes the gate (not 401/403)", ![401, 403].includes(r.status), r.status);
r = await call("/api/models", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } }); check("cron bearer token does NOT open other APIs", r.status === 401, r.status);

next.kill(); mock.server.close();
if (failed) { console.log(`\n${failed} check(s) failed. Server log tail:\n${log.slice(-1500)}`); process.exit(1); }
console.log("\nAll end-to-end auth checks passed.");
