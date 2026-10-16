import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0001_init.sql", "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // Supabase provides the storage schema; stub just what the migration touches.
  await db.exec("create schema storage; create table storage.buckets (id text primary key, name text, public boolean);");
  await db.exec(sql);
});

const rows = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows;

describe("0001_init.sql", () => {
  it("creates every table and seeds defaults", async () => {
    const t = (await rows<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")).map((r) => r.table_name);
    for (const name of ["profile", "answer_bank", "settings", "jobs", "job_scores", "documents", "applications", "apply_events", "model_configs", "model_usage"]) expect(t).toContain(name);
    expect((await rows("select 1 from model_configs")).length).toBe(8);
    expect(await rows("select label from model_configs where enabled=false order by label")).toEqual([{ label: "claude-sonnet" }, { label: "ollama-local" }]);
    expect((await rows<{ key: string }>("select key from settings order by key")).map((r) => r.key)).toEqual(["caps", "discovery", "scoring"]);
    expect(await rows("select id from storage.buckets")).toEqual([{ id: "documents" }]);
  });

  it("is safe to run twice (no duplicates, no errors)", async () => {
    await db.exec(sql);
    expect((await rows("select 1 from model_configs")).length).toBe(8);
  });

  it("enforces the single profile row and valid statuses", async () => {
    await db.query("insert into profile (id, data) values (1, '{}')");
    await expect(db.query("insert into profile (id, data) values (2, '{}')")).rejects.toThrow();
    await expect(db.query("insert into jobs (source, external_id, dedupe_key, title, company, url, status) values ('s','1','k','t','c','u','bogus')")).rejects.toThrow();
  });

  it("enforces one application per job and de-dupes jobs by source+external id", async () => {
    const j = (await rows<{ id: string }>("insert into jobs (source, external_id, dedupe_key, title, company, url) values ('adzuna','1','k','t','c','http://u') returning id"))[0].id;
    await expect(db.query("insert into jobs (source, external_id, dedupe_key, title, company, url) values ('adzuna','1','k2','t','c','http://u')")).rejects.toThrow();
    await db.query("insert into applications (job_id) values ($1)", [j]);
    await expect(db.query("insert into applications (job_id) values ($1)", [j])).rejects.toThrow();
    await expect(db.query("update applications set status='nonsense' where job_id=$1", [j])).rejects.toThrow();
  });

  it("cascades deletes from a job to its dependants", async () => {
    const j = (await rows<{ id: string }>("insert into jobs (source, external_id, dedupe_key, title, company, url) values ('x','9','k9','t','c','http://u') returning id"))[0].id;
    await db.query("insert into job_scores (job_id, score, detail, model) values ($1, 80, '{}', 'm')", [j]);
    await db.query("delete from jobs where id=$1", [j]);
    expect(await rows("select 1 from job_scores where job_id=$1", [j])).toEqual([]);
  });

  it("has row-level security on for every table (anon key reads nothing)", async () => {
    const off = await rows<{ relname: string }>("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
    expect(off).toEqual([]);
  });
});
