// End-to-end: real built Next app + mock Supabase. Run with: npm run build && npm run test:e2e
import { spawn } from "node:child_process";
import { startMock } from "./mock-supabase.mjs";

const MOCK = 4010, APP = 4011, BASE = `http://127.0.0.1:${APP}`;
const SECRET = "e2e-cron-secret-0123456789";
const mock = await startMock(MOCK);

const next = spawn("node_modules/.bin/next", ["start", "-p", String(APP)], {
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: SECRET, TELEGRAM_BOT_TOKEN: "tg-token-123", TELEGRAM_CHAT_ID: "98765", ALLOWED_EMAILS: "", E2E_MOCK_URL: `http://127.0.0.1:${MOCK}`, NODE_OPTIONS: "--require ./tests/e2e/redirect-fetch.cjs" },
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
  return { status: res.status, contentType: res.headers.get("content-type"), location: res.headers.get("location"), setCookie: res.headers.getSetCookie(), json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text };
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
r = await call("/?country=sg"); check("dashboard can be narrowed to one country", r.status === 200 && r.text.replace(/<!-- -->/g, "").includes("Singapore only") && r.text.includes("All countries"), `${r.status}`);
r = await call("/reports?country=sg"); check("reports can be narrowed to one country", r.status === 200 && r.text.replace(/<!-- -->/g, "").includes("Singapore only"), `${r.status}`);
r = await call("/reports?country=%27%3Bdrop"); check("a hostile country value on reports is ignored", r.status === 200 && !r.text.includes("Showing"), `${r.status}`);
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
{
  const jobsBefore = mock.rowsOf("jobs").length;
  r = await call("/api/jobs/manual", { method: "POST", body: { url: "https://sg.indeed.com/viewjob?jk=zeta-indeed", title: "Product Manager", company: "Zeta Pte", description: longDesc, country: "sg" } });
  check("the same role found on another portal is not stored twice", r.status === 409 && mock.rowsOf("jobs").length === jobsBefore, `${r.status} ${r.text}`);
  const z = mock.rowsOf("jobs").find((j) => j.company === "Zeta Pte");
  check("...but the other portal is recorded on the job", z.portal === "naukri" && JSON.stringify(z.seen_on) === '["indeed"]', JSON.stringify(z.seen_on));
  check("...and logged once, with both portals named", mock.rowsOf("activity_log").filter((l) => l.kind === "job.duplicate" && l.job_id === z.id).length === 1 && /also listed on Indeed.*first found on Naukri/i.test(mock.rowsOf("activity_log").find((l) => l.kind === "job.duplicate" && l.job_id === z.id).message), JSON.stringify(mock.rowsOf("activity_log").filter((l) => l.kind === "job.duplicate")));
  r = await call("/api/jobs/manual", { method: "POST", body: { url: "https://sg.indeed.com/viewjob?jk=zeta-indeed-2", title: "Product Manager", company: "Zeta Pte", description: longDesc, country: "sg" } });
  check("seeing it on the same portal again adds nothing", r.status === 409 && mock.rowsOf("activity_log").filter((l) => l.kind === "job.duplicate" && l.job_id === z.id).length === 1 && z.seen_on.length === 1, `${r.status}`);
}
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
check("the application keeps a snapshot of the job as it was (with its fit result)", application.job_snapshot?.title === "Product Manager" && application.job_snapshot.company === "Zeta Pte" && application.job_snapshot.description === longDesc && application.job_snapshot.fit?.score === 82 && !!application.job_snapshot.captured_at, JSON.stringify(application.job_snapshot)?.slice(0, 300));
check("...and a snapshot of the master profile it was prepared from", application.profile_snapshot?.profile?.basics?.name === "Asha Rao" && application.profile_snapshot.profile.experience.length > 0, JSON.stringify(application.profile_snapshot)?.slice(0, 200));
const beforeSnap = JSON.stringify([application.job_snapshot, application.profile_snapshot]);
r = await call("/api/profile/confirm", { method: "POST", body: { ...PROFILE, basics: { ...PROFILE.basics, name: "Changed Name", headline: "Changed headline" } } }); check("the master profile is edited afterwards", r.status === 200, `${r.status} ${r.text}`);
const mock_zeta = mock.rowsOf("applications").find((a) => a.id === application.id);
check("editing the profile does not change an existing application's snapshots", JSON.stringify([mock_zeta.job_snapshot, mock_zeta.profile_snapshot]) === beforeSnap, "snapshot changed");
r = await call(`/api/applications/${application.id}/original`); check("the original resume is rebuilt from the snapshot as a DOCX download", r.status === 200 && /wordprocessingml/.test(r.contentType ?? "") && r.text.startsWith("PK"), `${r.status} ${r.contentType}`);
{
  // two prepare requests at the same moment (double click, or a schedule and a button) must end with exactly one application
  r = await call("/api/jobs/manual", { method: "POST", body: { url: "https://www.naukri.com/job-listings-pm-race", title: "Product Manager", company: "Race Pte", description: longDesc, country: "sg" } });
  const raceJob = mock.rowsOf("jobs").find((j) => j.company === "Race Pte");
  const [p1, p2] = await Promise.all([call(`/api/jobs/${raceJob.id}/prepare`, { method: "POST" }), call(`/api/jobs/${raceJob.id}/prepare`, { method: "POST" })]);
  check("two simultaneous prepares both succeed", p1.status === 200 && p2.status === 200, `${p1.status} ${p1.text} / ${p2.status} ${p2.text}`);
  check("...and there is exactly one application and no duplicated document versions", mock.rowsOf("applications").filter((a) => a.job_id === raceJob.id).length === 1 && new Set(mock.rowsOf("documents").filter((d) => d.job_id === raceJob.id).map((d) => `${d.kind}-${d.version}`)).size === mock.rowsOf("documents").filter((d) => d.job_id === raceJob.id).length, "duplicates");
  check("both responses point at the same application", p1.json?.applicationId === p2.json?.applicationId, `${p1.text} ${p2.text}`);
  const raceApp = mock.rowsOf("applications").find((a) => a.job_id === raceJob.id);
  const [a1, a2] = await Promise.all([call(`/api/applications/${raceApp.id}`, { method: "POST", body: { action: "approve" } }), call(`/api/applications/${raceApp.id}`, { method: "POST", body: { action: "approve" } })]);
  check("two simultaneous approvals: exactly one wins, the other is told it is already being processed", [a1.status, a2.status].sort().join() === "200,409" && mock.rowsOf("activity_log").filter((l) => l.kind === "application.approved" && l.application_id === raceApp.id).length === 1 && mock.rowsOf("apply_events").filter((e) => e.application_id === raceApp.id && e.kind === "approved").length === 1, `${a1.status} ${a1.text} / ${a2.status} ${a2.text}`);
}
r = await call("/api/profile/confirm", { method: "POST", body: PROFILE }); check("profile restored for the remaining checks", r.status === 200, `${r.status}`);
r = await call("/api/applications/00000000-0000-4000-8000-000000000000/original"); check("an unknown application has no original", r.status === 404, `${r.status}`);
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

// ---- the scheduled pipeline, run by the real worker process (worker/pipeline.ts) against the emulator
const runWorker = (extra = {}) => new Promise((resolve) => {
  const out = `${process.env.TMPDIR ?? "/tmp"}/gh-output-${Date.now()}`;
  const p = spawn("node_modules/.bin/tsx", ["worker/pipeline.ts"], {
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: "service-key", E2E_MOCK_URL: `http://127.0.0.1:${MOCK}`, GITHUB_OUTPUT: out, NODE_OPTIONS: "--conditions=react-server --require ./tests/e2e/redirect-fetch.cjs", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = ""; p.stdout.on("data", (d) => (text += d)); p.stderr.on("data", (d) => (text += d));
  p.on("close", async (code) => { const { readFile } = await import("node:fs/promises"); resolve({ code, text, output: await readFile(out, "utf8").catch(() => "") }); });
});
const ghJob = (slug, company) => call("/api/jobs/manual", { method: "POST", body: { url: `https://boards.greenhouse.io/${slug}/jobs/1234`, title: "Product Manager", company, description: longDesc, country: "sg" } });
const dueNow = (id) => { const row = mock.rowsOf("schedules").find((x) => x.id === id); row.next_run_at = new Date(Date.now() - 60_000).toISOString(); };

r = await ghJob("autoco", "AutoCo"); check("a Greenhouse job is added for the pipeline", r.status === 200, `${r.status} ${r.text}`);
r = await call("/api/schedules", { method: "POST", body: { name: "Auto", frequency: "daily", timezone: "Asia/Singapore", countries: ["sg"], integrations: ["remotive"], mode: "scan_prepare_apply", require_approval: false, max_prepare: 20, max_apply: 5 } });
const autoId = JSON.parse(r.text).id; check("an auto-applying schedule is created", r.status === 200 && !!autoId, `${r.status} ${r.text}`);
r = await call("/api/cron/due", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } }); check("the tick endpoint reports nothing due yet", r.status === 200 && r.json?.due === 0 && r.json?.total === 1, `${r.status} ${r.text}`);
r = await call("/api/cron/due", { auth: false }); check("the tick endpoint is not open to the public", r.status === 401 || r.status === 307, r.status);
dueNow(autoId);
r = await call("/api/cron/due", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } }); check("the tick endpoint sees the due schedule", r.json?.due === 1 && r.json.schedules[0] === "Auto", `${r.text}`);
r = await call("/api/cron/discover", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } }); check("the old fixed-time job stands down once a schedule is active", r.json?.skipped !== undefined, r.text);

let w = await runWorker();
check("the pipeline worker exits cleanly", w.code === 0, `${w.code} ${w.text.slice(-800)}`);
const sch1 = mock.rowsOf("schedules").find((x) => x.id === autoId);
check("the due schedule was claimed: next run moved into the future and the result recorded", new Date(sch1.next_run_at) > new Date() && !!sch1.last_run_at && ["succeeded", "partial"].includes(sch1.last_run_status), JSON.stringify(sch1));
const pipeRun = mock.rowsOf("automation_runs").filter((x) => x.kind === "pipeline").at(-1);
check("a pipeline run is recorded for the schedule and finalised", pipeRun?.schedule_id === autoId && pipeRun.trigger === "schedule" && ["succeeded", "partial"].includes(pipeRun.status) && !!pipeRun.finished_at, JSON.stringify(pipeRun));
check("the run counted scoring, preparation and automatic approval", pipeRun.stats.prepared >= 1 && pipeRun.stats.auto_approved >= 1, JSON.stringify(pipeRun.stats));
const autoJob = mock.rowsOf("jobs").find((j) => j.company === "AutoCo");
const autoApp = mock.rowsOf("applications").find((a) => a.job_id === autoJob.id);
check("the Greenhouse application was prepared and approved for automatic submission", autoApp?.status === "approved" && autoApp.method === "automated", JSON.stringify(autoApp));
const approvedLog = mock.rowsOf("activity_log").find((l) => l.kind === "application.approved" && l.application_id === autoApp.id);
check("the approval is logged as made by a schedule, inside the run", approvedLog?.run_id === pipeRun.id && approvedLog.detail.actor === "schedule" && /automatically by a schedule/.test(approvedLog.message), JSON.stringify(approvedLog));
check("the worker told GitHub how many applications are ready to submit", /ready_to_submit=[1-9]/.test(w.output), w.output);
check("no GitHub dispatch was attempted for each application", !w.text.includes("dispatch failed"), w.text.slice(-300));

w = await runWorker();
check("running the worker again finds nothing due and creates no second run", w.code === 0 && /Nothing is due/.test(w.text) && mock.rowsOf("automation_runs").filter((x) => x.kind === "pipeline").length === 1 && /ready_to_submit=0/.test(w.output), `${w.code} ${w.text.slice(-300)}`);

r = await call(`/api/schedules/${autoId}`, { method: "PATCH", body: { paused: true } }); dueNow(autoId);
w = await runWorker(); check("a paused schedule is never run, even if its time has passed", /Nothing is due/.test(w.text), w.text.slice(-300));
r = await call(`/api/schedules/${autoId}`, { method: "DELETE" });

r = await ghJob("askco", "AskCo");
r = await call("/api/schedules", { method: "POST", body: { name: "Ask first", frequency: "daily", timezone: "Asia/Singapore", countries: ["sg"], integrations: ["remotive"], mode: "scan_prepare_apply", require_approval: true, max_prepare: 20, max_apply: 5 } });
const askId = JSON.parse(r.text).id; dueNow(askId);
w = await runWorker();
const askApp = mock.rowsOf("applications").find((a) => a.job_id === mock.rowsOf("jobs").find((j) => j.company === "AskCo").id);
check("a schedule that asks first prepares the application and leaves it pending approval", w.code === 0 && askApp?.status === "prepared", `${w.code} ${JSON.stringify(askApp)} ${w.text.slice(-300)}`);
check("nothing was approved by that run", !mock.rowsOf("activity_log").some((l) => l.kind === "application.approved" && l.application_id === askApp.id), "approved");
r = await call("/schedules"); check("the Schedules page shows the last run and its outcome", /Last run: <!-- -->[^<]*\d{4}/.test(r.text.replace(/\s+/g, " ")) || r.text.includes("(succeeded)") || r.text.includes("(partial)"), "no last-run info");
r = await call(`/logs/runs/${mock.rowsOf("automation_runs").filter((x) => x.kind === "pipeline").at(-1).id}`); check("the pipeline run has a detail page with its log", r.status === 200 && r.text.includes("pipeline run"), `${r.status}`);
r = await call(`/api/schedules/${askId}`, { method: "DELETE" });

// "Run now" with no GitHub connection runs the search and scoring part inline and says what was left out
r = await call("/api/schedules", { method: "POST", body: { name: "Manual", frequency: "daily", timezone: "Asia/Singapore", countries: ["sg"], integrations: ["remotive"], mode: "scan_prepare" } });
const manId = JSON.parse(r.text).id;
r = await call(`/api/schedules/${manId}/run`, { method: "POST" }); check("Run now works without the GitHub worker and says what was not run", r.status === 200 && r.json?.where === "inline" && /need the GitHub worker/.test(r.json.note), `${r.status} ${r.text}`);
r = await call(`/api/schedules/${manId}/run`, { method: "POST" }); check("Run now twice is safe", r.status === 200, `${r.status} ${r.text}`);
r = await call(`/api/schedules/not-a-uuid/run`, { method: "POST" }); check("Run now with a bad id is a 404", r.status === 404, r.status);
r = await call(`/api/schedules/${manId}`, { method: "DELETE" });

// ---- the apply worker (worker/apply.ts) in batch mode, driving a real browser against a local employer-style form
const { createHash, randomUUID } = await import("node:crypto");
const { pathToFileURL } = await import("node:url");
const RESUME_BYTES = Buffer.from("resume-bytes-v1"), COVER_BYTES = Buffer.from("cover-bytes-v1");
const formUrl = (hash = "") => pathToFileURL(`${process.cwd()}/tests/fixtures/greenhouse-like.html`).href + hash;
function seedApproved(company, hash, approvedAt) {
  const jobId = randomUUID(), resumeId = randomUUID(), coverId = randomUUID(), appId = randomUUID();
  mock.files.set(`${jobId}/resume-v1.docx`, RESUME_BYTES); mock.files.set(`${jobId}/cover-letter-v1.docx`, COVER_BYTES);
  mock.rowsOf("jobs").push({ id: jobId, source: "manual", external_id: appId, dedupe_key: appId, title: "Product Manager", company, country: "sg", url: formUrl(hash), apply_type: "greenhouse", portal: "greenhouse", description: "d", status: "prepared", found_at: new Date().toISOString() });
  mock.rowsOf("documents").push({ id: resumeId, job_id: jobId, kind: "resume", version: 1, content: {}, storage_path: `${jobId}/resume-v1.docx` }, { id: coverId, job_id: jobId, kind: "cover_letter", version: 1, content: {}, storage_path: `${jobId}/cover-letter-v1.docx` });
  mock.rowsOf("applications").push({ id: appId, job_id: jobId, resume_doc_id: resumeId, cover_doc_id: coverId, status: "approved", method: "automated", approved_at: approvedAt, answers: [{ question: "Expected CTC", answer: "32 LPA", source: "bank" }, { question: "Are you legally authorised to work in India?", answer: "Yes" }, { question: "Are you willing to relocate?", answer: "No" }], portal: "greenhouse", country: "sg", lifecycle: "none", created_at: new Date().toISOString() });
  return { jobId, appId };
}
const runApplyWorker = (extra = {}) => new Promise((resolve) => {
  const p = spawn("node_modules/.bin/tsx", ["worker/apply.ts"], {
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: "service-key", CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`, APPLY_PAUSE_MS: "0", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = ""; p.stdout.on("data", (d) => (text += d)); p.stderr.on("data", (d) => (text += d));
  p.on("close", (code) => resolve({ code, text }));
});
if (process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.CHROMIUM_PATH) {
  const good = seedApproved("FormCo", "", new Date(Date.now() - 20_000).toISOString());
  const stuck = seedApproved("StuckCo", "#unknown", new Date(Date.now() - 10_000).toISOString());
  const wk = await runApplyWorker();
  const orphan = mock.rowsOf("applications").find((a) => a.status === "failed" && /download/i.test(a.error ?? ""));
  check("an application whose files are missing is failed with the reason, and the rest of the batch still runs", wk.code === 1 && /approved application\(s\) to submit/.test(wk.text) && !!orphan, `${wk.code} ${JSON.stringify(orphan)} ${wk.text.slice(-500)}`);
  const a1 = mock.rowsOf("applications").find((a) => a.id === good.appId), a2 = mock.rowsOf("applications").find((a) => a.id === stuck.appId);
  check("the application that could be completed was submitted", a1.status === "submitted" && a1.lifecycle === "applied" && !!a1.submitted_at, JSON.stringify({ s: a1.status, e: a1.error }));
  const sub = a1.submission;
  check("the submission record names the method, the page and the outcome", sub?.version === 1 && sub.method === "automated" && sub.outcome === "submitted" && sub.target_url.startsWith("file://") && !!sub.final_url && sub.steps === 1, JSON.stringify(sub)?.slice(0, 400));
  check("every value entered is recorded with its source", sub.fields.some((f) => f.label === "First Name" && f.value === "Asha" && f.source === "profile") && sub.fields.some((f) => f.value === "32 LPA" && f.source === "answers") && sub.fields.some((f) => f.kind === "file"), JSON.stringify(sub.fields));
  check("the attached files are recorded with a SHA-256 of the exact bytes sent", sub.files.length === 2 && sub.files.find((f) => f.role === "resume").sha256 === createHash("sha256").update(RESUME_BYTES).digest("hex") && sub.files.find((f) => f.role === "cover_letter").sha256 === createHash("sha256").update(COVER_BYTES).digest("hex") && sub.files[0].bytes === RESUME_BYTES.length, JSON.stringify(sub.files));
  check("the employer's confirmation text and screenshot are kept", /Thank you/.test(sub.confirmation?.text ?? "") && sub.confirmation.screenshot === `screenshots/${good.appId}/confirmation.png` && a1.screenshot_path === sub.confirmation.screenshot, JSON.stringify(sub.confirmation));
  check("the job is marked applied and the submission is logged", mock.rowsOf("jobs").find((j) => j.id === good.jobId).status === "applied" && mock.rowsOf("activity_log").some((l) => l.kind === "application.submitted" && l.application_id === good.appId && l.detail.method === "automated"), "state missing");
  check("a form needing a human is handed back, not guessed", a2.status === "needs_input" && /favourite sorting algorithm/.test(a2.error ?? ""), JSON.stringify({ s: a2.status, e: a2.error }));
  check("the hand-back keeps what was filled and what was missing", a2.submission?.outcome === "needs_input" && a2.submission.unanswered.includes("Name your favourite sorting algorithm") && a2.submission.fields.length > 0 && a2.submission.confirmation === null && !!a2.submission.error, JSON.stringify(a2.submission)?.slice(0, 400));
  check("the hand-back is logged as needing the user", mock.rowsOf("activity_log").some((l) => l.kind === "application.needs_input" && l.application_id === stuck.appId), "no log");
  const again = await runApplyWorker();
  check("running the worker again does nothing and never submits twice", again.code === 0 && /No approved applications/.test(again.text) && mock.rowsOf("applications").find((a) => a.id === good.appId).status === "submitted", again.text.slice(-300));
  const single = await runApplyWorker({ APPLICATION_ID: good.appId });
  check("targeting an application that is already submitted is a no-op", single.code === 0 && /nothing to do/i.test(single.text) && mock.rowsOf("applications").find((a) => a.id === good.appId).submission.outcome === "submitted", single.text.slice(-300));
} else {
  console.log("SKIP  apply worker checks (set PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH)");
}

// ---- application detail page: A job, B documents, C answers and submission
{
  const strip = (t) => t.replace(/<!-- -->/g, "");
  r = await call(`/applications/${application.id}`);
  let t = strip(r.text);
  check("detail page renders all three sections with anchors", r.status === 200 && ["A. Job details", "B. Resume and documents", "C. Answers and submission"].every((x) => t.includes(x)) && t.includes('id="job"') && t.includes('id="documents"') && t.includes('id="answers"'), `${r.status}`);
  check("A names the other portals the same role was found on", t.includes("Also listed on") && t.includes("Indeed"), "missing");
  check("A shows the job as snapshotted: posting, portal, dates, fit, statuses and the full description", t.includes("naukri.com/job-listings-pm-zeta") && t.includes("Naukri") && t.includes("Full job description") && t.includes("Own the roadmap") && /Discovered/.test(t) && /application:/.test(t) && t.includes("As it was when this application was prepared"), "missing");
  check("B shows the tailored resume preview, the original, downloads and the change log", t.includes("Resume preview") && t.includes("Asha Rao") && t.includes("Download original resume") && t.includes("Original resume (your master profile when this was prepared)") && t.includes("Changes made for this job") && /Download DOCX/.test(t), "missing");
  check("B shows the cover letter text", t.includes("Cover letter v1"), "missing");
  check("the original keeps the pre-edit name, not the edited profile's", !t.includes("Changed Name"), "leaked");
  check("C shows prepared answers and says nothing was submitted by the app (marked by you)", t.includes("Answers prepared") && t.includes("Expected CTC") || t.includes("Total years of experience"), "answers missing");
  check("C shows the assisted submission record honestly", t.includes("Submitted by you") && t.includes("The values you entered there are not visible to this app"), "assisted record missing");
  r = await call(`/jobs/${application.job_id}`); check("the job page says it was also listed elsewhere", strip(r.text).includes("Also listed on Indeed"), "missing");
  check("the page links to this application's activity log", t.includes(`/logs?app=${application.id}`), "link missing");
  const worked = mock.rowsOf("applications").find((a) => a.submission?.method === "automated" && a.submission.outcome === "submitted");
  if (worked) {
    r = await call(`/applications/${worked.id}`); t = strip(r.text);
    check("C shows every value the worker entered, with where it came from", r.status === 200 && t.includes("Values entered") && t.includes("32 LPA") && t.includes("answer bank") && t.includes("First Name"), `${r.status}`);
    check("C shows the attached files with their SHA-256 and the employer's confirmation", t.includes("Files attached") && t.includes("Resume.docx") && t.includes("SHA-256") && /Thank you for applying/.test(t) && t.includes("Submitted automatically"), "missing");
    check("the snapshot-less seeded job still renders (older applications)", t.includes("prepared before snapshots existed") && t.includes("The original resume was not captured"), "legacy note missing");
  }
  const stuck2 = mock.rowsOf("applications").find((a) => a.submission?.outcome === "needs_input");
  if (stuck2) { r = await call(`/applications/${stuck2.id}`); t = strip(r.text); check("a hand-back shows what needed the user", t.includes("Needed you") && t.includes("favourite sorting algorithm"), "missing"); }
  r = await call("/applications/00000000-0000-4000-8000-000000000000"); check("an unknown application is a 404", r.status === 404, `${r.status}`);
}

// ---- filters on applications now run against real embedded jobs in the emulator
{
  r = await call("/applications?country=sg"); check("applications: country filter keeps matching applications", r.text.includes("Zeta Pte"), "Zeta missing");
  r = await call("/applications?country=in"); check("applications: country filter hides others", !r.text.includes("Zeta Pte") && r.text.includes("Nothing"), "Zeta still shown");
  r = await call("/applications?portal=naukri"); check("applications: portal filter keeps Naukri applications", r.text.includes("Zeta Pte") && !r.text.includes("FormCo"), "wrong rows");
  r = await call("/applications?portal=greenhouse&country=sg"); check("applications: portal and country combine", r.text.includes("FormCo") && !r.text.includes("Zeta Pte"), "wrong rows");
  r = await call("/applications?status=submitted"); check("applications: 'Submitted' shows submitted ones only", r.text.includes("FormCo") && !r.text.includes("StuckCo"), "wrong rows");
  r = await call("/applications?status=manual"); check("applications: 'Requires manual action' includes hand-backs", r.text.includes("StuckCo") || r.text.includes("Requires manual action"), "missing");
  r = await call("/?country=in"); check("dashboard: another country is echoed", r.status === 200 && r.text.replace(/<!-- -->/g, "").includes("India only"), `${r.status}`);
}

// ---- dashboard v2
{
  const strip = (t) => t.replace(/<!-- -->/g, "").replace(/&amp;/g, "&");
  r = await call("/"); let t = strip(r.text);
  check("dashboard shows portals, activity, the current backlog, funnel, breakdowns and failures", r.status === 200 && ["Portals and sources", "What happened", "Right now", "Funnel", "By country", "By portal", "Failures and what needs you", "Latest runs"].every((x) => t.includes(x)), `${r.status}`);
  check("dashboard names the connected portals with their status", t.includes("Adzuna") && t.includes("Remotive") && /Connected|Needs setup|Not set up|Error|Ready/i.test(t), "no portals");
  check("tiles deep-link to the filtered lists", t.includes('href="/applications?status=pending"') && t.includes('href="/applications?status=manual"') && t.includes('href="/applications?status=failed"') && t.includes('href="/jobs?view=skipped"') && t.includes('href="/applications?status=submitted"'), "links missing");
  check("failures are listed with their reasons", t.includes("Failures and what needs you") && (t.includes("favourite sorting algorithm") || t.includes("download")), "reasons missing");
  check("the worker-submitted application counts as submitted", /FormCo/.test(t) || /Submitted/.test(t), "missing");
  r = await call("/?period=today&country=sg"); t = strip(r.text);
  check("period and country filters work together and are echoed", r.status === 200 && t.includes("Today") && t.includes("Singapore only") && t.includes('href="/applications?status=pending&country=sg"'), `${r.status}`);
  r = await call("/?period=forever&country=%27%3Bdrop"); check("bad period and country values fall back safely", r.status === 200 && strip(r.text).includes("Last 7 days"), `${r.status}`);
  r = await call("/?period=30d&country=in"); check("a country with no activity shows zeros and no failures", r.status === 200 && strip(r.text).includes("Nothing failed in this period"), `${r.status}`);
}

// ---- daily reports
{
  const strip = (t) => t.replace(/<!-- -->/g, "").replace(/&amp;/g, "&");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  r = await call("/api/reports/daily", { method: "POST", body: { date: "2026-02-31" } }); check("an impossible report date is rejected", r.status === 400, `${r.status} ${r.text}`);
  r = await call("/api/reports/daily", { method: "POST", body: { date: "yesterday" } }); check("a non-date is rejected", r.status === 400, `${r.status}`);
  r = await call("/api/reports/daily", { method: "POST", body: {} }); check("today's report is generated and stored", r.status === 200 && r.json?.date === today && r.json.summary.found > 0 && mock.rowsOf("daily_reports").length === 1, `${r.status} ${r.text}`);
  const stored = mock.rowsOf("daily_reports")[0];
  check("it records the counts, linked items and the message body", stored.status === "ok" && stored.items.length > 0 && stored.items.every((x) => x.href.startsWith("/")) && stored.body.includes("Career Agent daily report"), JSON.stringify(stored).slice(0, 300));
  check("every item links to an existing job or application", stored.items.filter((x) => x.href.startsWith("/jobs/") || x.href.startsWith("/applications/")).every((x) => mock.rowsOf(x.href.startsWith("/jobs/") ? "jobs" : "applications").some((row) => row.id === x.href.split("/")[2])), "dangling link");
  check("the submitted application is in the report with its link", stored.items.some((x) => x.section === "submitted" && x.href.startsWith("/applications/")), "missing");
  check("failures carry their reasons", stored.items.some((x) => x.section === "failed" && x.detail && x.detail !== "No reason was recorded"), JSON.stringify(stored.items.filter((x) => x.section === "failed")));
  r = await call("/api/reports/daily", { method: "POST", body: {} }); check("generating again replaces the day's report instead of adding another", r.status === 200 && mock.rowsOf("daily_reports").length === 1, `${mock.rowsOf("daily_reports").length}`);
  r = await call(`/reports/daily/${today}`); let t = strip(r.text);
  check("the report page shows sections with deep links", r.status === 200 && t.includes("Daily report: " + today) && t.includes("Submitted") && t.includes('href="/applications/') && t.includes("Message as sent to Telegram"), `${r.status}`);
  r = await call("/reports"); check("the Reports page lists stored reports", strip(r.text).includes(`href="/reports/daily/${today}"`), "not listed");
  r = await call("/reports/daily/2026-02-31"); check("an invalid report date is a 404", r.status === 404, `${r.status}`);
  r = await call("/reports/daily/2001-01-01"); check("a day without a report is a 404", r.status === 404, `${r.status}`);
  const before = mock.seen.telegram.length;
  r = await call("/api/reports/daily", { method: "POST", body: { send: true } }); check("send=true delivers to Telegram and records it", r.status === 200 && r.json?.delivered === true && mock.seen.telegram.length === before + 1 && mock.rowsOf("daily_reports")[0].delivered === true, `${r.status} ${r.text}`);
  const tg = mock.seen.telegram.at(-1);
  check("the Telegram message uses the bot token and chat, and carries absolute-style report text", tg.path.includes("tg-token-123") && tg.body.chat_id === "98765" && /Found \d+ · matched/.test(tg.body.text), JSON.stringify(tg).slice(0, 300));
  r = await call("/api/cron/digest", { auth: false, headers: { Authorization: `Bearer ${SECRET}` } });
  check("the morning digest job stores and sends yesterday's report", r.status === 200 && r.json?.ok === true && mock.rowsOf("daily_reports").length === 2 && mock.seen.telegram.length === before + 2, `${r.status} ${r.text}`);
  r = await call("/logs?kind=report.generated"); check("report generation is logged", strip(r.text).includes("Daily report for " + today), "no log");
}

// ---- real-browser smoke test: every main page loads, hydrates without console errors; optional screenshots (E2E_SHOTS=dir)
if (process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.CHROMIUM_PATH) {
  const { chromium } = await import("playwright");
  const { mkdirSync } = await import("node:fs");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));
  const dir = process.env.E2E_SHOTS; if (dir) mkdirSync(dir, { recursive: true });
  const appId = mock.rowsOf("applications").find((a) => a.submission?.outcome === "submitted")?.id ?? application.id;
  const pages = ["/", "/jobs?view=all", "/applications", `/applications/${appId}`, `/applications/${application.id}`, "/portals", "/countries", "/schedules", "/reports", `/reports/daily/${mock.rowsOf("daily_reports")[0].report_date}`, "/logs", "/logs/runs", "/system", "/settings", "/profile", "/models"];
  for (const path of pages) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    if (dir) await page.screenshot({ path: `${dir}/${path === "/" ? "dashboard" : path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`browser: ${path.split("?")[0].replace(/[0-9a-f-]{36}/, ":id")} loads, hydrates cleanly and fits the window`, res?.status() === 200 && errors.length === 0 && !overflow, `${res?.status()} overflow=${overflow} ${errors.slice(0, 2).join(" | ")}`);
    await page.close();
  }
  await browser.close();
}

// ---- models: saved keys are encrypted at rest, used for calls, and removable
const KEY = "sk-test-key-1234567890";
mock.modelConfigs.set("e2e-model", { id: "m1", label: "e2e-model", provider: "mock", base_url: `http://127.0.0.1:${MOCK}/v1`, model: "mock-1", api_key_env: "E2E_KEY", tasks: ["score"], priority: 1, daily_cap: null, enabled: true });
// ---- per-country preferences ----
r = await call("/countries"); check("Countries page renders", r.status === 200 && r.text.includes("Countries"), `${r.status}`);
r = await call("/api/country-prefs", { method: "PUT", body: { country: "SINGAPORE" } }); check("a bad country code is rejected", r.status === 400, `${r.status} ${r.text}`);
r = await call("/api/country-prefs", { method: "PUT", body: { country: "sg", currency: "sgd" } }); check("a lower-case currency code is rejected", r.status === 400, `${r.status} ${r.text}`);
r = await call("/api/country-prefs", { method: "PUT", body: { country: "sg", titles: ["Product Manager", "product manager", "Program Lead"], locations: ["Singapore"], remote: "hybrid_ok", salary_min: 100000, currency: "SGD", work_authorisation: "needs_sponsorship" } });
check("saving a country works", r.status === 200, `${r.status} ${r.text}`);
r = await call("/countries"); check("the saved country is shown with its criteria", r.text.includes("Singapore") && r.text.includes("Program Lead"), "missing");
r = await call("/logs?kind=config.changed"); check("saving a country is logged", r.text.includes("Country settings saved: Singapore"), "no log entry");
r = await call("/api/country-prefs?country=sg", { method: "DELETE" }); check("removing a country works", r.status === 200, `${r.status}`);
r = await call("/api/country-prefs?country=bad", { method: "DELETE" }); check("removing with a bad code is refused", r.status === 400, `${r.status}`);

// ---- schedules
r = await call("/schedules"); check("Schedules page renders with an empty state", r.status === 200 && r.text.includes("No schedules yet"), `${r.status}`);
r = await call("/api/schedules", { method: "POST", body: { name: "x", timezone: "Mars/Base" } }); check("an unknown time zone is rejected", r.status === 400 && /time zone/i.test(r.text), `${r.status} ${r.text}`);
r = await call("/api/schedules", { method: "POST", body: { name: "Weekly", frequency: "weekly" } }); check("a weekly schedule without days is rejected", r.status === 400 && /day/i.test(r.text), `${r.status} ${r.text}`);
r = await call("/api/schedules", { method: "POST", body: { name: "Morning", frequency: "daily", time_of_day: "08:30", timezone: "Asia/Singapore", mode: "scan_prepare_apply", max_apply: 3, require_approval: false } });
check("a valid schedule is created with a next run", r.status === 200 && !!JSON.parse(r.text).next_run_at, `${r.status} ${r.text}`);
const sch = mock.rowsOf("schedules")[0];
check("the next run is 08:30 in the schedule's own time zone", sch && new Date(sch.next_run_at).toISOString().slice(11, 16) === "00:30", String(sch?.next_run_at));
r = await call("/schedules"); check("the schedule is listed with its plain-English timing", r.text.includes("Morning") && r.text.includes("Every day at 08:30 (Asia/Singapore)") && r.text.includes("Active"), "missing");
r = await call(`/api/schedules/${sch.id}`, { method: "PATCH", body: { paused: true } }); check("a schedule can be paused", r.status === 200 && mock.rowsOf("schedules")[0].paused === true && mock.rowsOf("schedules")[0].next_run_at === null, `${r.status} ${r.text}`);
r = await call("/schedules"); check("a paused schedule shows as Paused with no next run", r.text.includes("Paused") && r.text.includes("not scheduled"), "wrong state");
r = await call(`/api/schedules/${sch.id}`, { method: "PATCH", body: { paused: false } }); check("a schedule can be resumed", r.status === 200 && !!mock.rowsOf("schedules")[0].next_run_at, `${r.status} ${r.text}`);
r = await call(`/api/schedules/${sch.id}`, { method: "PUT", body: { name: "Evening", frequency: "weekdays", time_of_day: "18:00", timezone: "Europe/London" } }); check("a schedule can be edited", r.status === 200 && mock.rowsOf("schedules")[0].name === "Evening", `${r.status} ${r.text}`);
r = await call("/api/schedules/not-a-uuid", { method: "PATCH", body: { paused: true } }); check("an invalid schedule id is a 404", r.status === 404, r.status);
r = await call("/logs?kind=schedule.changed"); check("schedule changes are logged", r.text.includes("Schedule created: Morning") && r.text.includes("Schedule paused: Morning") && r.text.includes("Schedule edited: Evening"), "log missing");
r = await call(`/api/schedules/${sch.id}`, { method: "DELETE" }); check("a schedule can be deleted", r.status === 200 && mock.rowsOf("schedules").length === 0, `${r.status}`);

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
