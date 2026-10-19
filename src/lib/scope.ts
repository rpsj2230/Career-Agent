import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySchemaError } from "@/lib/schema";

/**
 * One app, several people. Every table that belongs to one person carries a profile_id, and this wrapper puts the
 * right one on every read, update, delete and insert, so no query anywhere can see or touch another profile's rows.
 * The rest of the code keeps writing `db().from("jobs").select(...)` exactly as before.
 *
 * Deliberately free of "server-only" and of anything that needs Next.js, so the proxy and the workers can use it too.
 */

/** Tables whose rows belong to exactly one profile. */
export const PROFILE_TABLES: ReadonlySet<string> = new Set([
  "profile", "answer_bank", "settings", "jobs", "job_scores", "documents", "applications", "apply_events",
  "integrations", "schedules", "automation_runs", "portal_scans", "activity_log", "country_prefs", "daily_reports",
]);

/** Tables whose unique key now includes profile_id: an explicit onConflict must name it too. */
const PROFILE_KEYED: ReadonlySet<string> = new Set(["profile", "answer_bank", "settings", "jobs", "integrations", "country_prefs", "daily_reports"]);

/** Settings that belong to the whole app (who may sign in, model keys, job-source keys), kept in shared_settings. */
export const SHARED_SETTING_KEYS: readonly string[] = [
  "owner", "team", "model_keys", "model_keys_shared", "integration_keys", "telegram_buttons", "apify_usage", "automation_tick", "local_model", "local_model_test",
];
const SHARED = new Set(SHARED_SETTING_KEYS);
export const isSharedSetting = (key: string): boolean => SHARED.has(key);

export type Scope = { kind: "legacy" } | { kind: "profiles"; profileId: () => Promise<string> };

type Call = [string, unknown[]];
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;

/** The keys a query on `settings` names, from .eq("key", x), .in("key", [...]) and the rows being written. */
export function settingKeys(calls: Call[]): string[] {
  const out: string[] = [];
  for (const [name, args] of calls) {
    if (name === "eq" && args[0] === "key" && typeof args[1] === "string") out.push(args[1]);
    else if (name === "in" && args[0] === "key" && Array.isArray(args[1])) out.push(...args[1].filter((x): x is string => typeof x === "string"));
    else if ((name === "insert" || name === "upsert") && args[0]) for (const r of Array.isArray(args[0]) ? args[0] : [args[0]]) if (typeof (r as Row)?.key === "string") out.push((r as Row).key as string);
  }
  return out;
}

function stamp(rows: unknown, pid: string, table: string): unknown {
  const one = (r: unknown): unknown => {
    if (!r || typeof r !== "object") return r;
    const have = (r as Row).profile_id;
    if (have !== undefined && have !== null && have !== pid) throw new Error(`Refused: a write to ${table} named another profile (${String(have)}) than the one in use.`);
    return { ...(r as Row), profile_id: pid };
  };
  return Array.isArray(rows) ? rows.map(one) : one(rows);
}

const withoutProfile = (v: unknown): unknown => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const { profile_id: _drop, ...rest } = v as Row;
  void _drop;
  return rest;
};

async function run(raw: SupabaseClient, table: string, calls: Call[], scope: () => Promise<Scope>): Promise<unknown> {
  const first = calls[0];
  if (!first || !["select", "insert", "upsert", "update", "delete"].includes(first[0])) throw new Error(`db().from("${table}") must start with select, insert, upsert, update or delete`);
  const s = await scope();
  let target = table;
  let pid: string | null = null;
  if (s.kind === "profiles") {
    if (table === "settings") {
      const keys = settingKeys(calls);
      const shared = keys.filter(isSharedSetting).length;
      if (shared > 0 && shared !== keys.length) throw new Error("A settings query named both app-wide and per-profile keys; split it in two.");
      if (shared > 0) target = "shared_settings";
    }
    if (target === table) pid = await s.profileId();
  }
  const [op, args] = first;
  let b: Builder = raw.from(target);
  switch (op) {
    case "select":
      b = b.select(...args);
      if (pid) b = b.eq("profile_id", pid);
      break;
    case "insert":
      b = b.insert(pid ? stamp(args[0], pid, table) : args[0], args[1]);
      break;
    case "upsert": {
      const opts = { ...((args[1] as Row | undefined) ?? {}) };
      if (pid && typeof opts.onConflict === "string" && PROFILE_KEYED.has(table) && !/\bprofile_id\b/.test(opts.onConflict)) opts.onConflict = `profile_id,${opts.onConflict}`;
      b = b.upsert(pid ? stamp(args[0], pid, table) : args[0], opts);
      break;
    }
    case "update":
      b = b.update(pid ? withoutProfile(args[0]) : args[0], args[1]);
      if (pid) b = b.eq("profile_id", pid);
      break;
    case "delete":
      b = b.delete(args[0]);
      if (pid) b = b.eq("profile_id", pid);
      break;
  }
  for (const [name, a] of calls.slice(1)) b = b[name](...a);
  return await b;
}

/** A query that has not run yet: every chained call is recorded, and replayed (with the profile added) when it is awaited. */
function deferred(raw: SupabaseClient, table: string, scope: () => Promise<Scope>): unknown {
  const calls: Call[] = [];
  let started: Promise<unknown> | null = null;
  const start = () => (started ??= run(raw, table, calls, scope));
  const self: unknown = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") return (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => start().then(ok, bad);
      if (prop === "catch") return (bad?: (e: unknown) => unknown) => start().catch(bad);
      if (prop === "finally") return (f?: () => void) => start().finally(f);
      return (...args: unknown[]) => {
        if (started) throw new Error(`db().from("${table}").${prop}() was called after the query had already run`);
        calls.push([prop, args]);
        return self;
      };
    },
  });
  return self;
}

/** `client` with every per-person table scoped as described above. Tables that are not per-person pass straight through. */
export function scopeClient(client: SupabaseClient, scope: () => Promise<Scope>): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") return (table: string) => (PROFILE_TABLES.has(table) ? deferred(target, table, scope) : target.from(table));
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// ---------------------------------------------------------------- is the profiles migration applied?
let enabledMemo = false;
let notBefore = 0;

/** True once the profiles table exists. A "not yet" answer is re-checked every few seconds, so running the SQL takes effect without a redeploy. */
export async function profilesEnabled(raw: SupabaseClient, now: number = Date.now()): Promise<boolean> {
  if (enabledMemo) return true;
  if (now < notBefore) return false;
  const { error } = await raw.from("profiles").select("id").limit(1);
  if (!error) { enabledMemo = true; return true; }
  if (classifySchemaError(error) === "table") { notBefore = now + 5_000; return false; }
  throw new Error(`could not check whether profiles are set up: ${error.message}`);
}

export function resetProfilesEnabledForTests() { enabledMemo = false; notBefore = 0; }

/** For code that has no profile (the sign-in check): only app-wide settings are reachable, anything per-person is refused. */
export function sharedOnlyClient(raw: SupabaseClient): SupabaseClient {
  return scopeClient(raw, async () => ((await profilesEnabled(raw)) ? { kind: "profiles", profileId: async () => { throw new Error("This code has no profile; it may only use app-wide data."); } } : { kind: "legacy" }));
}
