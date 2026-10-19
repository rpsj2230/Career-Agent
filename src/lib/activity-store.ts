import { NoProfileError } from "./profile-context";
import { rawClient } from "./raw-client";
import { scopedDb } from "./scoped-db";

/**
 * The narrow set of database operations the activity module needs. Production uses Supabase; tests use an
 * in-memory store, including one that always fails, to prove logging can never break the caller.
 */
export interface ActivityStore {
  insert(table: string, row: Record<string, unknown>): Promise<{ id: string | number } | null>;
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<void>;
  update(table: string, id: string | number, patch: Record<string, unknown>): Promise<void>;
  selectOne(table: string, id: string | number): Promise<Record<string, unknown> | null>;
  selectWhere(table: string, filter: { column: string; op: "eq" | "lt"; value: string }, limit: number): Promise<Record<string, unknown>[]>;
}

/** Service-role store. Deliberately free of "server-only" so the GitHub Actions worker can use it too. */
export function supabaseStore(): ActivityStore {
  // the log of the profile in use. Events that belong to nobody (a sign-in attempt, before anyone has chosen a profile) go to the main profile's log,
  // which is what the database does by itself with a row that names no profile
  const sb = scopedDb();
  const anyone = async <T,>(f: (c: ReturnType<typeof scopedDb>) => PromiseLike<T>): Promise<T> => { try { return await f(sb); } catch (e) { if (e instanceof NoProfileError) return await f(rawClient()); throw e; } };
  const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
  return {
    async insert(table, row) {
      const { data, error } = await anyone((c) => c.from(table).insert(row).select("id").single());
      fail(`insert ${table}`, error);
      return data as { id: string | number };
    },
    async insertMany(table, rows) {
      if (rows.length === 0) return;
      const { error } = await anyone((c) => c.from(table).insert(rows));
      fail(`insert ${table}`, error);
    },
    async update(table, id, patch) {
      const { error } = await sb.from(table).update(patch).eq("id", id);
      fail(`update ${table}`, error);
    },
    async selectOne(table, id) {
      const { data, error } = await sb.from(table).select("*").eq("id", id).maybeSingle();
      fail(`select ${table}`, error);
      return (data as Record<string, unknown> | null) ?? null;
    },
    async selectWhere(table, f, limit) {
      const q = sb.from(table).select("*");
      const { data, error } = await (f.op === "eq" ? q.eq(f.column, f.value) : q.lt(f.column, f.value)).limit(limit);
      fail(`select ${table}`, error);
      return (data as Record<string, unknown>[]) ?? [];
    },
  };
}
