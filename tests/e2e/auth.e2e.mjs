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
