// In-memory stand-in for the parts of Supabase the app uses, for local end-to-end tests only:
//  * GoTrue (auth): password login, user lookup, logout, admin create-user
//  * PostgREST: a generic table emulator (select with filters/order/limit/range, insert, upsert, update, delete,
//    unique keys, single/maybeSingle) plus schema simulation (tables/columns that do not exist yet)
//  * fake OpenAI-compatible chat endpoint and fake external job APIs under /ext/<host>/...
// It does not enforce real security and it is not Postgres; it approximates the behaviour the app relies on.
import http from "node:http";
import { randomUUID } from "node:crypto";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const users = new Map();
const tokens = new Map();
let n = 0;

// ------------------------------------------------------------------ schema simulation
const V1_TABLES = ["profile", "settings", "answer_bank", "jobs", "job_scores", "documents", "applications", "apply_events", "model_configs", "model_usage"];
const V2_TABLES = ["integrations", "schedules", "automation_runs", "portal_scans", "activity_log", "country_prefs", "daily_reports"];
const V2_COLUMNS = { jobs: ["portal", "scan_id", "run_id", "salary_min", "salary_max", "salary_currency", "salary_estimated", "decided_at"], applications: ["job_snapshot", "profile_snapshot", "submission", "portal", "country", "run_id"] };
const schema = { v2: false };

// ------------------------------------------------------------------ table store
const PK = { settings: ["key"], profile: ["id"], model_configs: ["label"], integrations: ["id"], country_prefs: ["country"], jobs: ["id"] };
const UNIQUE = { jobs: [["source", "external_id"]], answer_bank: [["key"]], daily_reports: [["report_date", "timezone"]] };
const DEFAULTS = {
  jobs: () => ({ id: randomUUID(), found_at: new Date().toISOString(), status: "new" }),
  automation_runs: () => ({ id: randomUUID(), started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), status: "running", stats: {}, scope: {} }),
  portal_scans: () => ({ id: randomUUID(), started_at: new Date().toISOString(), status: "running", fetched: 0, inserted: 0, duplicates: 0, stale: 0, invalid: 0, detail: {} }),
  activity_log: () => ({ id: ++n, at: new Date().toISOString(), level: "info", detail: {} }),
  integrations: () => ({ enabled: true, status: "unknown", jobs_found_total: 0 }),
  schedules: () => ({ id: randomUUID(), enabled: true, paused: false }),
  applications: () => ({ id: randomUUID(), status: "prepared", answers: [] }),
  documents: () => ({ id: randomUUID() }),
  apply_events: () => ({ id: ++n, at: new Date().toISOString() }),
  model_usage: () => ({ id: ++n, created_at: new Date().toISOString() }),
};
const tables = new Map();
const rowsOf = (t) => tables.get(t) ?? tables.set(t, []).get(t);
const pkOf = (t) => PK[t] ?? ["id"];
const uniquesOf = (t) => [pkOf(t), ...(UNIQUE[t] ?? [])];
const sameKey = (a, b, cols) => cols.every((c) => a[c] !== undefined && String(a[c]) === String(b[c]));

function parseFilters(params) {
  const out = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (k === "or") { // or=(a.ilike.%x%,b.ilike.%x%)
      const parts = v.replace(/^\(|\)$/g, "").split(",").map((p) => { const [col, op, ...rest] = p.split("."); return { col, op, val: rest.join(".") }; });
      out.push({ or: parts });
      continue;
    }
    const dot = v.indexOf(".");
    out.push({ col: k, op: v.slice(0, dot), val: v.slice(dot + 1) });
  }
  return out;
}
function matches(row, f) {
  if (f.or) return f.or.some((g) => matches(row, g));
  const x = row[f.col];
  const cmp = (a, b) => (isNaN(Date.parse(a)) || isNaN(Date.parse(b)) || /^\d+$/.test(String(a)) ? (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0) : Date.parse(a) - Date.parse(b));
  switch (f.op) {
    case "eq": return String(x) === f.val;
    case "neq": return String(x) !== f.val;
    case "lt": return x != null && cmp(x, f.val) < 0;
    case "lte": return x != null && cmp(x, f.val) <= 0;
    case "gt": return x != null && cmp(x, f.val) > 0;
    case "gte": return x != null && cmp(x, f.val) >= 0;
    case "in": return f.val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(x));
    case "is": return f.val === "null" ? x == null : String(x) === f.val;
    case "like":
    case "ilike": {
      const re = new RegExp("^" + f.val.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".") + "$", f.op === "ilike" ? "i" : "");
      return x != null && re.test(String(x));
    }
    default: return true;
  }
}
const project = (row, select) => {
  if (!select || select === "*") return row;
  const cols = select.split(",").map((c) => c.trim()).filter((c) => c && !c.includes("(") && !c.includes(":"));
  return Object.fromEntries(cols.map((c) => [c, row[c]]));
};
const schemaError = (table, cols) => {
  const known = V1_TABLES.includes(table) || (schema.v2 && V2_TABLES.includes(table));
  if (!known) return { status: 404, body: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } };
  if (!schema.v2) {
    const bad = cols.find((c) => (V2_COLUMNS[table] ?? []).includes(c));
    if (bad) return { status: 400, body: { code: "PGRST204", message: `Could not find the '${bad}' column of '${table}' in the schema cache` } };
  }
  return null;
};

// Adapters so tests can read/write tables like simple maps.
const mapView = (table, keyCol, valCol) => ({
  get: (k) => rowsOf(table).find((r) => r[keyCol] === k)?.[valCol],
  has: (k) => rowsOf(table).some((r) => r[keyCol] === k),
  set: (k, v) => { const r = rowsOf(table).find((x) => x[keyCol] === k); if (r) r[valCol] = v; else rowsOf(table).push({ [keyCol]: k, [valCol]: v, ...(DEFAULTS[table]?.() ?? {}) }); },
  delete: (k) => { tables.set(table, rowsOf(table).filter((r) => r[keyCol] !== k)); },
  get size() { return rowsOf(table).length; },
});
const settings = mapView("settings", "key", "value");
const modelConfigs = { set: (label, row) => { const rows = rowsOf("model_configs"); const i = rows.findIndex((r) => r.label === label); if (i >= 0) rows[i] = row; else rows.push(row); }, get: (l) => rowsOf("model_configs").find((r) => r.label === l) };
const seen = { lastChatAuth: null, lastChatBody: null, external: [], uploads: [] };

// ------------------------------------------------------------------ external provider fakes (/ext/<host>/<path>)
export const externalFixtures = {
  adzunaCount: 5,
  adzunaResults: [
    { id: 101, title: "Product Manager", company: { display_name: "Acme Pte Ltd" }, location: { display_name: "Singapore" }, redirect_url: "https://www.adzuna.sg/land/ad/101", description: "Own the roadmap and work with engineers. ".repeat(4), created: new Date().toISOString() },
    { id: 102, title: "Senior Product Manager", company: { display_name: "Beta Corp" }, location: { display_name: "Singapore" }, redirect_url: "https://www.adzuna.sg/land/ad/102", description: "Lead a team of product managers. ".repeat(4), created: new Date().toISOString() },
  ],
  failHosts: new Set(),
};
function external(host, path, url, req, res) {
  seen.external.push({ host, path, key: req.headers["x-rapidapi-key"] ?? null, query: Object.fromEntries(url.searchParams) });
  if (externalFixtures.failHosts.has(host)) return send(res, 429, { message: "quota" });
  if (host === "api.adzuna.com") return send(res, 200, { count: externalFixtures.adzunaCount, results: externalFixtures.adzunaResults });
  if (host === "remotive.com") return send(res, 200, { "job-count": 1, jobs: [{ id: 7, title: "Remote Product Manager", company_name: "Gamma", url: "https://remotive.com/remote-jobs/7", description: "<p>Fully remote.</p>".repeat(10), candidate_required_location: "Worldwide", publication_date: new Date().toISOString() }] });
  if (host === "jsearch.p.rapidapi.com") return send(res, 200, { data: [{ job_id: "js1", job_title: "Product Manager", employer_name: "Delta", job_country: "SG", job_city: "Singapore", job_apply_link: "https://delta.example.com/careers/1", job_description: "Great role. ".repeat(10), job_publisher: "LinkedIn" }] });
  if (host === "boards-api.greenhouse.io") return send(res, 200, { jobs: [] });
  return send(res, 404, { message: `no fake for ${host}` });
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });

function rest(req, res, url, table, body) {
  const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object+json");
  const prefer = req.headers.prefer ?? "";
  const returnRep = prefer.includes("return=representation");
  const filters = parseFilters(url.searchParams);
  const select = url.searchParams.get("select");
  const cols = [...(select ?? "").split(",").map((c) => c.trim()).filter((c) => c && !c.includes("(") && c !== "*"), ...filters.flatMap((f) => (f.or ? f.or.map((g) => g.col) : [f.col]))];
  const bodyCols = (Array.isArray(body) ? body : body ? [body] : []).flatMap((r) => Object.keys(r));
  const err = schemaError(table, [...cols, ...bodyCols]);
  if (err) return send(res, err.status, err.body);
  const rows = rowsOf(table);
  const respondRows = (list, status = 200) => {
    const out = list.map((r) => project(r, select));
    if (wantsObject) return out.length === 1 ? send(res, status, out[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    return send(res, status, out);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    let list = rows.filter((r) => filters.every((f) => matches(r, f)));
    const order = url.searchParams.get("order");
    if (order) for (const spec of order.split(",").reverse()) { const [c, d] = spec.split("."); list = [...list].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === "desc" ? -1 : 1)); }
    const totalBeforePaging = list.length;
    const range = (req.headers.range ?? "").match(/^(\d+)-(\d+)$/);
    if (range) list = list.slice(+range[1], +range[2] + 1);
    const lim = url.searchParams.get("limit");
    if (lim !== null) list = list.slice(0, +lim);
    if (req.method === "HEAD") return send(res, 200, undefined, { "Content-Range": `0-${Math.max(list.length - 1, 0)}/${list.length}` });
    if (prefer.includes("count=exact")) res.setHeader("Content-Range", `${range ? range[1] : 0}-${Math.max(list.length - 1 + (range ? +range[1] : 0), 0)}/${totalBeforePaging}`);
    return respondRows(list);
  }
  if (req.method === "POST") {
    const incoming = Array.isArray(body) ? body : [body];
    const upsertMode = prefer.includes("resolution=merge-duplicates") ? "merge" : prefer.includes("resolution=ignore-duplicates") ? "ignore" : null;
    const onConflict = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
    const created = [];
    for (const raw of incoming) {
      const row = { ...(DEFAULTS[table]?.() ?? {}), ...raw };
      const uniq = onConflict.length ? [onConflict, ...uniquesOf(table)] : uniquesOf(table);
      const clash = rows.find((r) => uniq.some((cols) => cols.every((c) => row[c] !== undefined) && sameKey(row, r, cols)));
      if (clash) {
        if (upsertMode === "merge") { Object.assign(clash, raw); created.push(clash); continue; }
        if (upsertMode === "ignore") continue;
        return send(res, 409, { code: "23505", message: `duplicate key value violates unique constraint "${table}_pkey"`, details: null, hint: null });
      }
      rows.push(row); created.push(row);
    }
    return returnRep ? respondRows(created, 201) : send(res, 201);
  }
  if (req.method === "PATCH") {
    const list = rows.filter((r) => filters.every((f) => matches(r, f)));
    list.forEach((r) => Object.assign(r, body));
    return returnRep ? respondRows(list) : send(res, 204);
  }
  if (req.method === "DELETE") {
    const keep = rows.filter((r) => !filters.every((f) => matches(r, f)));
    tables.set(table, keep);
    return send(res, 204);
  }
  return send(res, 405, { message: "method not supported by mock" });
}

export function startMock(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; } // uploads are not JSON
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

    // ---- database
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (m) return rest(req, res, url, m[1], body);

    // ---- OpenAI-compatible chat endpoint: answers each task like a model would, so whole flows can run
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      seen.lastChatAuth = req.headers.authorization ?? null; seen.lastChatBody = body;
      const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const prompt = body.messages?.find((m) => m.role === "user")?.content ?? "";
      let content = '{"answer":"4"}';
      if (/You assess how well a job matches/.test(system)) {
        const low = /Principal/.test(prompt);
        content = JSON.stringify({ score: low ? 40 : 82, matchedSkills: ["SQL"], gaps: low ? ["Team leadership"] : [], seniorityFit: "ok", locationVisaFit: "ok", salarySignal: "unknown", summary: low ? "Too senior for this profile" : "Strong match" });
      } else if (/tailor a candidate's resume/.test(system)) {
        const exp = prompt.match(/\[(exp\d+)\] /)?.[1];
        const bullet = prompt.match(/\[(exp\d+\.b\d+)\] ([^\n]+)/);
        const skill = prompt.match(/\[(skill\d+)\]/)?.[1];
        content = JSON.stringify({ headline: "Product Manager", summary: { text: "Product manager with relevant experience", sourceIds: ["summary"] }, experience: [{ experienceId: exp, bullets: [{ text: bullet?.[2], sourceIds: [bullet?.[1]] }] }], skillIds: skill ? [skill] : [], certificationIds: [] });
      } else if (/short cover letter/.test(system)) {
        const bullet = prompt.match(/\[(exp\d+\.b\d+)\] ([^\n]+)/);
        content = JSON.stringify({ text: "Dear hiring team,\n\nI would like to apply for this role.\n\nKind regards", sourceIds: [bullet?.[1]] });
      }
      return send(res, 200, { id: "c1", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }

    // ---- file storage (uploads are kept so tests can inspect them)
    const st = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (st && (req.method === "POST" || req.method === "PUT")) {
      seen.uploads.push({ bucket: st[1], path: decodeURIComponent(st[2]), bytes: raw.length });
      return send(res, 200, { Key: `${st[1]}/${st[2]}`, Id: randomUUID() });
    }

    // ---- external job APIs (requests are redirected here by redirect-fetch.cjs)
    const ext = url.pathname.match(/^\/ext\/([^/]+)(\/.*)$/);
    if (ext) return external(ext[1], ext[2], url, req, res);

    send(res, 404, { message: `mock: no route for ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    server, users, tokens, settings, modelConfigs, seen, tables, rowsOf, fixtures: externalFixtures,
    applyMigration2: () => { schema.v2 = true; },
  })));
}
