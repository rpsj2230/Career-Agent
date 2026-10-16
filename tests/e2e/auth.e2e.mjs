// End-to-end: real built Next app + mock Supabase. Run with: npm run build && npm run test:e2e
import { spawn } from "node:child_process";
import { startMock } from "./mock-supabase.mjs";

const MOCK = 4010, APP = 4011, BASE = `http://127.0.0.1:${APP}`;
const SECRET = "e2e-cron-secret-0123456789";
const mock = await startMock(MOCK);

const next = spawn("node_modules/.bin/next", ["start", "-p", String(APP)], {
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${MOCK}`, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: SECRET, ALLOWED_EMAILS: "" },
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
mock.applyMigration2();
r = await call("/api/system/recheck", { method: "POST" }); check("Re-check endpoint reports the database is now healthy", r.status === 200 && r.json?.ok === true, `${r.status} ${r.text}`);
r = await call("/system");
check("after the migration is applied, a re-check reports up to date", r.status === 200 && r.text.includes("up to date") && !r.text.includes("Database update needed"), `${r.status} upToDate=${r.text.includes("up to date")} banner=${r.text.includes("Database update needed")} check_failed=${r.text.includes("check failed")} snippet=${(r.text.match(/Database[^<]{0,40}<[^>]*>[^<]{0,60}/g) ?? []).slice(0, 3).join(" | ")}`);

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
