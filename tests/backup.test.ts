import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupName, backupsToDelete, isApplicationDocument, tablesFromMigrations } from "../scripts/lib/backup-lib.mjs";
import { startMock } from "./e2e/mock-supabase.mjs";

const run = async (args: string[], env: NodeJS.ProcessEnv) => (await promisify(execFile)("node", args, { env })).stdout; // asynchronous: the stand-in server lives in this same process

describe("backup helpers", () => {
  it("lists the tables in migration order", () => {
    expect(tablesFromMigrations(["create table if not exists a (id int);\ncreate table if not exists public.b (id int);", "create table if not exists a (x int); create table if not exists c (id int);"])).toEqual(["a", "b", "c"]);
    expect(tablesFromMigrations(["create table if not exists jobs (id int);", "create table if not exists profiles (id int); create table if not exists shared_settings (key text);"])).toEqual(["profiles", "jobs", "shared_settings"]);
  });
  it("leaves out per-application documents but keeps the master resume", () => {
    expect(isApplicationDocument("0c1d2e3f-aaaa-4bbb-8ccc-1234567890ab/resume-v1.docx")).toBe(true);
    expect(isApplicationDocument("master/original-1.docx")).toBe(false);
  });
  it("keeps the newest 60 daily backups: day 61 replaces day 1", () => {
    const days = Array.from({ length: 61 }, (_, i) => `db-${new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)}.tar.gz.enc`);
    expect(backupsToDelete(days, 60)).toEqual([days[0]]);
    expect(backupsToDelete([...days, "README.md", "db-notes.txt"], 60)).toEqual([days[0]]);
    expect(backupsToDelete(days.slice(0, 60), 60)).toEqual([]);
    expect(backupName(new Date("2026-03-05T10:00:00Z"))).toBe("db-2026-03-05.tar.gz.enc");
  });
});

describe("backup and restore end to end (against the Supabase stand-in)", () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  beforeAll(async () => { mock = await startMock(4120); });
  afterAll(() => { mock?.server?.close?.(); });

  it("exports every table and the non-application files, then restores them after the data is lost", async () => {
    const env = { ...process.env, SUPABASE_URL: "http://127.0.0.1:4120", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
    const a = createClient("http://127.0.0.1:4120", "service-key", { auth: { persistSession: false } });
    const ins = await a.from("jobs").insert([{ source: "t", external_id: "1", title: "PM", company: "Acme", description: "d", url: "https://x", apply_type: "unknown" }, { source: "t", external_id: "2", title: "PO", company: "Beta", description: "e", url: "https://y", apply_type: "unknown" }]).select("id");
    expect(ins.error).toBeNull();
    await a.from("settings").upsert({ key: "owner", value: { email: "me@x.com" } });
    await a.from("settings").upsert({ key: "keep", value: { a: 1 } });
    mock.files.set("master/original-1.docx", Buffer.from("MASTER"));
    mock.files.set("0c1d2e3f-aaaa-4bbb-8ccc-1234567890ab/resume-v1.docx", Buffer.from("APP DOC"));

    const out = mkdtempSync(join(tmpdir(), "bk-"));
    await run(["scripts/backup.mjs", out], env);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(manifest.tables.jobs).toBe(2);
    const jobs = gunzipSync(readFileSync(join(out, "db", "jobs.ndjson.gz"))).toString().trim().split("\n").map((l) => JSON.parse(l));
    expect(jobs.map((j: { company: string }) => j.company).sort()).toEqual(["Acme", "Beta"]);
    expect(readFileSync(join(out, "storage", "master", "original-1.docx"), "utf8")).toBe("MASTER");
    expect(existsSync(join(out, "storage", "0c1d2e3f-aaaa-4bbb-8ccc-1234567890ab"))).toBe(false);
    expect(manifest.storage.skippedApplicationDocuments).toBe(1);

    // everything is lost; a dry run changes nothing, then the real restore brings it back
    mock.rowsOf("jobs").length = 0; mock.rowsOf("settings").length = 0; mock.files.clear();
    const dry = await run(["scripts/restore.mjs", out], env);
    expect(dry).toMatch(/would restore jobs: 2/);
    expect(mock.rowsOf("jobs").length).toBe(0);
    await run(["scripts/restore.mjs", out, "--apply", "--reset-owner"], env);
    expect(mock.rowsOf("jobs").map((j: { company: string }) => j.company).sort()).toEqual(["Acme", "Beta"]);
    expect(mock.rowsOf("settings").some((r: { key: string }) => r.key === "keep")).toBe(true);
    expect(mock.rowsOf("settings").some((r: { key: string }) => r.key === "owner")).toBe(false);
    expect(mock.seen.uploads.some((u: { path: string }) => u.path === "master/original-1.docx")).toBe(true);
  }, 90_000);
});
