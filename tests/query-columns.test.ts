import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Every column the run and pipeline queries name must exist in the database schema. A wrong column makes Supabase return an error,
 * which the screens would otherwise show as "0" (this is how "0 scored" and an empty "How applying went" went unnoticed).
 */
const sql = ["0001_init", "0002_portals_runs_logs_schedules", "0003_profiles"].map((f) => readFileSync(`supabase/migrations/${f}.sql`, "utf8").replace(/--.*$/gm, "")).join("\n");

function columnsByTable(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const get = (t: string) => tables.get(t) ?? tables.set(t, new Set(["profile_id"])).get(t)!;
  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const line of m[2].split("\n")) {
      const col = line.trim().match(/^(\w+)\s+\w/)?.[1];
      if (col && !/^(primary|unique|check|foreign|constraint)$/i.test(col)) get(m[1]).add(col);
    }
  }
  for (const m of sql.matchAll(/alter table (\w+) add column if not exists (\w+)/g)) get(m[1]).add(m[2]);
  return tables;
}
const schema = columnsByTable();

const used: { table: string; column: string }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const recorder = (table: string) => {
    const note = (col: unknown) => { if (typeof col === "string") used.push({ table, column: col }); };
    const c: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "gte", "lte", "gt", "lt", "like", "ilike", "in", "is", "order"]) c[m] = (col: unknown) => { note(col); return c; };
    c.select = (cols: unknown) => { if (typeof cols === "string") for (const part of cols.replace(/(\w+:)?\w+(!inner)?\([^)]*\)/g, "").split(",")) { const p = part.trim(); if (p && p !== "*") note(p); } return c; };
    for (const m of ["range", "limit", "maybeSingle", "single"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(f);
    return c;
  };
  return { db: () => ({ from: recorder }) };
});

import { readPipelineCounts } from "@/lib/pipeline-counts";
import { applyLogs } from "@/lib/log-queries";
import { recentPipelineRuns, runApplications, runJobs, runModels, runProblems } from "@/lib/run-queries";

const missing = () => used.filter((u) => !schema.get(u.table)?.has(u.column)).map((u) => `${u.table}.${u.column}`);

describe("columns named by the pipeline and run queries exist", () => {
  it("knows the real schema", () => {
    expect(schema.get("job_scores")).toContain("job_id");
    expect(schema.get("job_scores")).not.toContain("id");
    expect(schema.get("activity_log")).toContain("at");
    expect(schema.get("activity_log")).not.toContain("created_at");
  });
  it("pipeline counts", async () => {
    used.length = 0;
    await readPipelineCounts(new Date(), 65);
    expect(used.length).toBeGreaterThan(10);
    expect(missing()).toEqual([]);
  });
  it("applying report", async () => {
    used.length = 0;
    await applyLogs({ from: "2026-10-01", to: "2026-10-02", run: "r" });
    expect(used.length).toBeGreaterThan(3);
    expect(missing()).toEqual([]);
  });
  it("run detail queries", async () => {
    used.length = 0;
    await runJobs("r"); await runApplications("r"); await runProblems("r"); await runModels({ started_at: "2026-10-01T00:00:00Z", finished_at: null }); await recentPipelineRuns();
    expect(used.length).toBeGreaterThan(15);
    expect(missing()).toEqual([]);
  });
});
