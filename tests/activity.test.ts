import { beforeEach, describe, expect, it, vi } from "vitest";
import { failStaleRuns, finishScan, logActivity, logMany, startRun, startScan, withRun, writeFailures } from "@/lib/activity";
import type { ActivityStore } from "@/lib/activity-store";

type Row = Record<string, unknown>;

/** In-memory store. `failing` makes every call throw, like a database that is down or not migrated. */
function memoryStore(failing = false) {
  const tables = new Map<string, Row[]>();
  let n = 0;
  const t = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!;
  const boom = () => { if (failing) throw new Error('relation "x" does not exist'); };
  const store: ActivityStore = {
    async insert(table, row) { boom(); const r = { id: `${table}-${++n}`, ...row }; t(table).push(r); return { id: r.id as string }; },
    async insertMany(table, rows) { boom(); rows.forEach((r) => t(table).push({ id: `${table}-${++n}`, ...r })); },
    async update(table, id, patch) { boom(); Object.assign(t(table).find((r) => r.id === id) ?? {}, patch); },
    async selectOne(table, id) { boom(); return t(table).find((r) => r.id === id) ?? null; },
    async selectWhere(table, f, limit) { boom(); return t(table).filter((r) => String(r[f.column]) < f.value).slice(0, limit); },
  };
  return { store, tables, t };
}

beforeEach(() => { writeFailures.count = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("logActivity / logMany", () => {
  it("writes entries with defaults and truncates huge messages", async () => {
    const m = memoryStore();
    await logActivity({ kind: "job.rejected", message: "x".repeat(5000), portal: "indeed", country: "sg" }, m.store);
    const r = m.t("activity_log")[0];
    expect(r).toMatchObject({ kind: "job.rejected", level: "info", portal: "indeed", country: "sg", run_id: null, detail: {} });
    expect(String(r.message)).toHaveLength(2000);
    expect(await logMany([], m.store)).toBe(true);
    await logMany([{ kind: "scan.started", message: "a" }, { kind: "scan.started", message: "b" }], m.store);
    expect(m.t("activity_log")).toHaveLength(3);
  });
  it("never throws when the database is down, and keeps the lost entry in the process log", async () => {
    const m = memoryStore(true);
    await expect(logActivity({ kind: "scan.failed", message: "boom", level: "error" }, m.store)).resolves.toBe(false);
    expect(writeFailures.count).toBe(1);
    const logged = (console.error as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("could not record activity");
    expect(logged).toContain("scan.failed");
  });
});

describe("withRun", () => {
  it("records a succeeded run with counters, start and finish times", async () => {
    const m = memoryStore();
    const out = await withRun({ trigger: "manual", kind: "scan" }, async (ctx) => { ctx.stat("discovered", 5); ctx.stat("discovered", 2); await ctx.log({ kind: "scan.finished", message: "ok" }); return 42; }, m.store);
    expect(out).toBe(42);
    const run = m.t("automation_runs")[0];
    expect(run).toMatchObject({ status: "succeeded", stats: { discovered: 7 }, error: null });
    expect(run.finished_at).toBeTruthy();
    expect(m.t("activity_log").map((r) => r.kind)).toEqual(["run.started", "scan.finished", "run.finished"]);
    expect(m.t("activity_log").every((r) => r.run_id === run.id)).toBe(true);
  });
  it("marks the run partial when some sources failed but the run completed", async () => {
    const m = memoryStore();
    await withRun({ trigger: "schedule", kind: "pipeline" }, async (ctx) => { ctx.markPartial("jsearch: 429"); }, m.store);
    expect(m.t("automation_runs")[0]).toMatchObject({ status: "partial", error: "jsearch: 429" });
  });
  it("marks the run failed, keeps the counters so far, logs the error and rethrows", async () => {
    const m = memoryStore();
    await expect(withRun({ trigger: "manual", kind: "pipeline" }, async (ctx) => { ctx.stat("discovered", 3); throw new Error("model quota exhausted"); }, m.store)).rejects.toThrow("model quota exhausted");
    expect(m.t("automation_runs")[0]).toMatchObject({ status: "failed", error: "model quota exhausted", stats: { discovered: 3 } });
    expect(m.t("activity_log").at(-1)).toMatchObject({ kind: "run.failed", level: "error", status: "failed" });
  });
  it("still runs the work, and still returns its result, when the log database is unavailable", async () => {
    const m = memoryStore(true);
    const out = await withRun({ trigger: "manual", kind: "scan" }, async (ctx) => { ctx.stat("x"); return "done"; }, m.store);
    expect(out).toBe("done");
    expect(writeFailures.count).toBeGreaterThan(0);
  });
  it("still propagates the work's own error when logging is also failing", async () => {
    const m = memoryStore(true);
    await expect(withRun({ trigger: "manual", kind: "scan" }, async () => { throw new Error("real problem"); }, m.store)).rejects.toThrow("real problem");
  });
});

describe("scans", () => {
  it("records a successful scan with its counts and a matching log line", async () => {
    const m = memoryStore();
    const o = { integration: "adzuna", country: "sg", query: "Product Manager" };
    const id = await startScan(o, m.store);
    await finishScan(id, o, { status: "ok", fetched: 30, inserted: 12, duplicates: 15, stale: 2, invalid: 1 }, m.store);
    expect(m.t("portal_scans")[0]).toMatchObject({ status: "ok", fetched: 30, inserted: 12, duplicates: 15, stale: 2, invalid: 1, error: null });
    expect(m.t("activity_log")[0]).toMatchObject({ kind: "scan.finished", integration: "adzuna", country: "sg", scan_id: id });
    expect(String(m.t("activity_log")[0].message)).toContain("12 new");
  });
  it("persists a failed scan with the reason (previously only returned in the HTTP response)", async () => {
    const m = memoryStore();
    const o = { integration: "jsearch", country: "in", query: "PM" };
    const id = await startScan(o, m.store);
    await finishScan(id, o, { status: "error", error: "429 Too Many Requests from jsearch.p.rapidapi.com" }, m.store);
    expect(m.t("portal_scans")[0]).toMatchObject({ status: "error", error: "429 Too Many Requests from jsearch.p.rapidapi.com" });
    expect(m.t("activity_log")[0]).toMatchObject({ kind: "scan.failed", level: "error" });
  });
});

describe("failStaleRuns", () => {
  it("fails runs that stopped sending heartbeats and leaves healthy and finished runs alone", async () => {
    const m = memoryStore();
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    const fresh = new Date().toISOString();
    m.t("automation_runs").push(
      { id: "stale", status: "running", heartbeat_at: old },
      { id: "healthy", status: "running", heartbeat_at: fresh },
      { id: "done", status: "succeeded", heartbeat_at: old },
    );
    expect(await failStaleRuns(30, m.store)).toBe(1);
    expect(m.t("automation_runs").map((r) => [r.id, r.status])).toEqual([["stale", "failed"], ["healthy", "running"], ["done", "succeeded"]]);
    expect(m.t("activity_log")[0]).toMatchObject({ kind: "run.failed", run_id: "stale" });
  });
  it("returns 0 instead of throwing when the database is unavailable", async () => {
    expect(await failStaleRuns(30, memoryStore(true).store)).toBe(0);
  });
});

describe("startRun", () => {
  it("returns null (not an exception) when it cannot create the run", async () => {
    expect(await startRun({ trigger: "manual", kind: "scan" }, memoryStore(true).store)).toBeNull();
  });
});
