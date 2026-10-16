// Minimal in-memory stand-in for the parts of Supabase the app uses: GoTrue (auth) and PostgREST (`settings` table).
// Only for local end-to-end tests; it does not enforce real security.
import http from "node:http";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const users = new Map();   // email -> { id, email, password }
const tokens = new Map();  // access_token -> email
const settings = new Map(); // key -> value
const modelConfigs = new Map(); // label -> row
const seen = { lastChatAuth: null, lastChatBody: null };

// Schema simulation, for the "database behind the code" tests. Base tables accept any column; the migration-0002
// tables and the new jobs/applications columns appear only after applyMigration2() is called.
const V1_TABLES = ["profile", "settings", "answer_bank", "jobs", "job_scores", "documents", "applications", "apply_events", "model_configs", "model_usage"];
const V2_TABLES = ["integrations", "schedules", "automation_runs", "portal_scans", "activity_log", "country_prefs", "daily_reports"];
const V2_COLUMNS = { jobs: ["portal", "scan_id", "run_id", "salary_min", "decided_at"], applications: ["job_snapshot", "profile_snapshot", "submission", "portal", "country"] };
const schema = { v2: false };
let n = 0;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });

export function startMock(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
    const body = raw ? JSON.parse(raw) : {};
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");

    // ---- auth
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const u = users.get(String(body.email).toLowerCase());
      if (!u || u.password !== body.password) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email: u.email, exp, aud: "authenticated", role: "authenticated", session_id: `s${++n}` })}.sig${n}`;
      tokens.set(access, u.email);
      return send(res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `r${n}`, user: userJson(u) });
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const email = tokens.get(bearer);
      return email ? send(res, 200, userJson(users.get(email))) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") { tokens.delete(bearer); return send(res, 204); }
    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      const email = String(body.email).toLowerCase();
      if (users.has(email)) return send(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const u = { id: `u${users.size + 1}`, email, password: body.password };
      users.set(email, u);
      return send(res, 200, userJson(u));
    }

    // ---- PostgREST: settings(key, value)
    if (url.pathname === "/rest/v1/settings") {
      const eq = url.searchParams.get("key")?.replace(/^eq\./, "");
      if (req.method === "GET") {
        const rows = [...settings].filter(([k]) => !eq || k === eq).map(([key, value]) => ({ key, value }));
        if ((req.headers.accept ?? "").includes("vnd.pgrst.object+json")) {
          return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        }
        return send(res, 200, rows);
      }
      if (req.method === "POST") {
        const upsert = (req.headers.prefer ?? "").includes("merge-duplicates");
        if (settings.has(body.key) && !upsert) return send(res, 409, { code: "23505", message: 'duplicate key value violates unique constraint "settings_pkey"', details: null, hint: null });
        settings.set(body.key, body.value);
        return send(res, 201, (req.headers.prefer ?? "").includes("return=representation") ? [body] : undefined);
      }
      if (req.method === "DELETE") { if (eq) settings.delete(eq); return send(res, 204); }
    }
    // ---- PostgREST: model_configs (read-only here)
    if (url.pathname === "/rest/v1/model_configs" && req.method === "GET") {
      const eq = url.searchParams.get("label")?.replace(/^eq\./, "");
      return send(res, 200, [...modelConfigs.values()].filter((r) => !eq || r.label === eq));
    }

    // ---- an OpenAI-compatible chat endpoint, so model tests can run without a real provider
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      seen.lastChatAuth = req.headers.authorization ?? null; seen.lastChatBody = body;
      return send(res, 200, { id: "c1", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"answer":"4"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    // ---- generic table probe used by the schema health check: GET /rest/v1/<table>?select=<cols>&limit=0
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (m && req.method === "GET") {
      const table = m[1];
      const known = V1_TABLES.includes(table) || (schema.v2 && V2_TABLES.includes(table));
      if (!known) return send(res, 404, { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null });
      const missing = schema.v2 ? [] : V2_COLUMNS[table] ?? [];
      const bad = (url.searchParams.get("select") ?? "").split(",").find((c) => missing.includes(c.trim()));
      if (bad) return send(res, 400, { code: "42703", message: `column ${table}.${bad} does not exist`, details: null, hint: null });
      return send(res, 200, []);
    }
    send(res, 404, { message: `mock: no route for ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, users, tokens, settings, modelConfigs, seen, applyMigration2: () => { schema.v2 = true; } })));
}
