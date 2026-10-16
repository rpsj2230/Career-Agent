import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const sql1 = readFileSync("supabase/migrations/0001_init.sql", "utf8");
const sql2 = readFileSync("supabase/migrations/0002_portals_runs_logs_schedules.sql", "utf8");
const sql = sql1 + "\n" + sql2;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // Supabase provides the storage schema; stub just what the migration touches.
  await db.exec("create schema storage; create table storage.buckets (id text primary key, name text, public boolean);");
  await db.exec(sql1);
  // rows that exist BEFORE 0002 runs, to prove the backfill
  await db.exec("insert into jobs (source, external_id, dedupe_key, title, company, country, url) values ('jsearch:in:PM','b1','k-b1','t','c','in','https://www.linkedin.com/jobs/view/1'),('adzuna:in:PM','b2','k-b2','t','c','in','https://www.adzuna.in/land/ad/9')");
  await db.exec(sql2);
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

import { detectPortal } from "@/lib/jobs/portal";

describe("0002_portals_runs_logs_schedules.sql", () => {
  it("creates the new tables and columns", async () => {
    const t = (await rows<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public'")).map((r) => r.table_name);
    for (const name of ["integrations", "schedules", "automation_runs", "portal_scans", "activity_log", "country_prefs", "daily_reports"]) expect(t).toContain(name);
    const cols = (await rows<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_schema='public'")).map((r) => `${r.table_name}.${r.column_name}`);
    for (const c of ["jobs.portal", "jobs.scan_id", "jobs.run_id", "jobs.salary_min", "applications.job_snapshot", "applications.profile_snapshot", "applications.submission", "applications.country"]) expect(cols).toContain(c);
  });

  it("backfills the originating portal on jobs that existed before the migration", async () => {
    expect(await rows("select source, portal from jobs where external_id in ('b1','b2') order by external_id")).toEqual([
      { source: "jsearch:in:PM", portal: "linkedin" },
      { source: "adzuna:in:PM", portal: "adzuna" },
    ]);
  });

  it("is safe to run twice and does not touch existing portal values", async () => {
    await db.exec(sql2);
    await db.exec(sql2);
    expect((await rows("select portal from jobs where external_id='b1'"))[0]).toEqual({ portal: "linkedin" });
  });

  it("SQL backfill and detectPortal() agree on every URL shape", async () => {
    const samples: [string, string][] = [
      ["https://www.linkedin.com/jobs/view/1", "jsearch:in:PM"], ["https://in.indeed.com/viewjob?jk=1", "jsearch:in:PM"], ["https://www.glassdoor.co.in/job/1", "jsearch:in:PM"],
      ["https://www.naukri.com/job-listings-x", "manual"], ["https://www.foundit.in/job/1", "manual"], ["https://www.monsterindia.com/x", "manual"],
      ["https://www.shine.com/jobs/x", "manual"], ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse:acme"], ["https://jobs.lever.co/acme/1", "lever:acme"],
      ["https://remotive.com/remote-jobs/x", "remotive:PM"], ["https://wellfound.com/jobs/1", "manual"], ["https://acme.com/careers/1", "adzuna:in:PM"], ["https://www.adzuna.in/land/ad/1", "adzuna:in:PM"],
      ["https://linkedin.com.evil.com/jobs/1", "manual"], ["https://uk.indeed.co.uk/viewjob", "jsearch:gb:PM"], ["https://notnaukri.com/x", "manual"], ["https://indeed.evil.com/x", "manual"], ["https://glassdoor.evil.org/x", "manual"], ["https://www.foundit.sg/job/1", "manual"], ["https://remotive.io/x", "remotive:PM"],
    ];
    for (const [i, [url, source]] of samples.entries()) {
      await db.query("insert into jobs (source, external_id, dedupe_key, title, company, url, portal) values ($1,$2,$3,'t','c',$4,null)", [source, `p${i}`, `kp${i}`, url]);
    }
    await db.exec(sql2); // idempotent re-run performs the backfill for the null rows
    for (const [i, [url, source]] of samples.entries()) {
      const sqlPortal = (await rows<{ portal: string }>("select portal from jobs where external_id=$1", [`p${i}`]))[0].portal;
      expect(sqlPortal, url).toBe(detectPortal({ url, integration: source }));
    }
  });

  it("rejects invalid schedules, country preferences and runs", async () => {
    await expect(db.query("insert into schedules (name, time_of_day) values ('x','25:99')")).rejects.toThrow();
    await expect(db.query("insert into schedules (name, frequency) values ('x','hourly')")).rejects.toThrow();
    await expect(db.query("insert into country_prefs (country, salary_min, salary_max) values ('sg', 9, 3)")).rejects.toThrow();
    await expect(db.query("insert into country_prefs (country, currency) values ('au','aud')")).rejects.toThrow();
    await expect(db.query("insert into country_prefs (country) values ('SGP')")).rejects.toThrow();
    await expect(db.query("insert into automation_runs (status) values ('exploded')")).rejects.toThrow();
    await db.query("insert into schedules (name) values ('daily scan')");
    await db.query("insert into country_prefs (country, currency, salary_min, salary_max) values ('sg','SGD',5000,9000)");
  });

  it("keeps log rows when the things they refer to are deleted (history is never lost)", async () => {
    const run = (await rows<{ id: string }>("insert into automation_runs (trigger) values ('manual') returning id"))[0].id;
    const scan = (await rows<{ id: string }>("insert into portal_scans (run_id, integration) values ($1,'adzuna') returning id", [run]))[0].id;
    const job = (await rows<{ id: string }>("insert into jobs (source, external_id, dedupe_key, title, company, url, scan_id, run_id) values ('adzuna','z1','kz1','t','c','http://u',$1,$2) returning id", [scan, run]))[0].id;
    await db.query("insert into activity_log (kind, message, run_id, scan_id, job_id) values ('scan.finished','x',$1,$2,$3)", [run, scan, job]);
    await db.query("delete from jobs where id=$1", [job]);
    await db.query("delete from portal_scans where id=$1", [scan]);
    await db.query("delete from automation_runs where id=$1", [run]);
    expect(await rows("select kind, job_id, scan_id, run_id from activity_log where kind='scan.finished'")).toEqual([{ kind: "scan.finished", job_id: null, scan_id: null, run_id: null }]);
  });

  it("allows one daily report per date and time zone", async () => {
    await db.query("insert into daily_reports (report_date, timezone) values ('2026-10-16','Asia/Kolkata')");
    await expect(db.query("insert into daily_reports (report_date, timezone) values ('2026-10-16','Asia/Kolkata')")).rejects.toThrow();
    await db.query("insert into daily_reports (report_date, timezone) values ('2026-10-16','UTC')");
  });
});
