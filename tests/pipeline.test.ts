import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityStore } from "@/lib/activity-store";
import { pipelineSummaryText, runPipeline, type PipelineDeps, type QueuedJob } from "@/lib/pipeline/run";

type Row = Record<string, unknown>;
function memoryStore() {
  const tables = new Map<string, Row[]>();
  let n = 0;
  const t = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!;
  const store: ActivityStore = {
    async insert(table, row) { const r = { id: `${table}-${++n}`, ...row }; t(table).push(r); return { id: r.id as string }; },
    async insertMany(table, rows) { rows.forEach((r) => t(table).push({ id: `${table}-${++n}`, ...r })); },
    async update(table, id, patch) { Object.assign(t(table).find((r) => r.id === id) ?? {}, patch); },
    async selectOne(table, id) { return t(table).find((r) => r.id === id) ?? null; },
    async selectWhere() { return []; },
  };
  return { store, t };
}

const job = (i: number, o: Partial<QueuedJob> = {}): QueuedJob => ({ id: `j${i}`, title: `Role ${i}`, company: `Co ${i}`, country: "sg", portal: "greenhouse", apply_type: "greenhouse", score: 70 + i, ...o });
const sched = (o: Record<string, unknown> = {}) => ({ id: "s1", name: "Morning", countries: [], integrations: [], mode: "scan_prepare_apply" as const, require_approval: false, max_prepare: 10, max_apply: 2, ...o });

function setup(jobs: QueuedJob[], over: Partial<PipelineDeps> = {}) {
  const m = memoryStore();
  const calls = { prepared: [] as string[], approved: [] as string[] };
  let clock = 0;
  const deps: PipelineDeps = {
    store: m.store,
    scan: async (ctx) => { ctx.stat("inserted", 4); },
    // a backlog of 4 jobs: the first pass scores it, later passes find nothing left
    score: (() => { let first = true; return async () => { const r = first ? { scored: 4, queued: jobs.length, skipped: 1, failed: 0 } : { scored: 0, queued: 0, skipped: 0, failed: 0 }; first = false; return r; }; })(),
    queuedJobs: async () => jobs,
    failedPrepareAttempts: async () => 0,
    prepare: async (id) => { calls.prepared.push(id); return { applicationId: `app-${id}`, verified: true }; },
    approve: async (id) => { calls.approved.push(id); return { ok: true, mode: "automated", note: null }; },
    loadCaps: async () => ({ caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: false }, state: { automatedToday: 0, linkedinAutomatedToday: 0, linkedinAutomatedThisWeek: 0 } }),
    now: () => (clock += 1000),
    ...over,
  };
  return { m, deps, calls };
}
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

const runRow = (m: ReturnType<typeof memoryStore>) => m.t("automation_runs")[0];

describe("runPipeline", () => {
  it("records a pipeline run for the schedule and finalises it", async () => {
    const { m, deps } = setup([job(1)]);
    const s = await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(runRow(m)).toMatchObject({ kind: "pipeline", schedule_id: "s1", trigger: "schedule", status: "succeeded" });
    expect(s).toMatchObject({ inserted: 4, scored: 4, prepared: 1, autoApproved: 1, runId: runRow(m).id });
  });

  it("the global Auto-Apply switch off leaves every application waiting, whatever the schedule says", async () => {
    const { deps, calls } = setup([job(1), job(2)], { autoApplyEnabled: async () => false });
    const s = await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(calls.prepared).toHaveLength(2); // still found, scored and prepared
    expect(calls.approved).toEqual([]);
    expect(s).toMatchObject({ autoApproved: 0, awaitingApproval: 2 });
  });

  it("the global Auto-Apply switch on lets the schedule approve as before", async () => {
    const { deps, calls } = setup([job(1)], { autoApplyEnabled: async () => true });
    await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(calls.approved).toEqual(["app-j1"]);
  });

  it("an unreadable Auto-Apply switch counts as off", async () => {
    const { deps, calls } = setup([job(1)], { autoApplyEnabled: async () => { throw new Error("db down"); } });
    await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(calls.approved).toEqual([]);
  });

  it("scan-only schedules never prepare or approve", async () => {
    const { deps, calls } = setup([job(1), job(2)]);
    const s = await runPipeline(sched({ mode: "scan" }), deps, { trigger: "schedule" });
    expect(calls.prepared).toEqual([]); expect(calls.approved).toEqual([]);
    expect(s.prepared).toBe(0);
  });

  it("prepare-only schedules leave every application waiting for approval", async () => {
    const { deps, calls } = setup([job(1), job(2), job(3)]);
    const s = await runPipeline(sched({ mode: "scan_prepare", require_approval: true, max_apply: 0 }), deps, { trigger: "schedule" });
    expect(calls.prepared.length).toBe(3); expect(calls.approved).toEqual([]);
    expect(s).toMatchObject({ prepared: 3, awaitingApproval: 3, autoApproved: 0 });
  });

  it("prepares the best matches first and no more than the limit", async () => {
    const { deps, calls } = setup([job(1, { score: 60 }), job(2, { score: 95 }), job(3, { score: 80 })]);
    await runPipeline(sched({ max_prepare: 2, mode: "scan_prepare", require_approval: true }), deps, { trigger: "manual" });
    expect(calls.prepared).toEqual(["j2", "j3"]);
  });

  it("with approval required, nothing is approved even in apply mode", async () => {
    const { deps, calls } = setup([job(1)]);
    const s = await runPipeline(sched({ require_approval: true }), deps, { trigger: "schedule" });
    expect(calls.approved).toEqual([]); expect(s.awaitingApproval).toBe(1);
  });

  it("stops automatic submissions at max_apply but still approves manual-only portals", async () => {
    const jobs = [job(1), job(2), job(3, { apply_type: "portal", portal: "naukri" }), job(4)];
    const { deps, calls } = setup(jobs, { approve: async (id) => { calls.approved.push(id); return id === "app-j3" ? { ok: true, mode: "assisted", note: null } : { ok: true, mode: "automated", note: null }; } });
    const s = await runPipeline(sched({ max_apply: 2 }), deps, { trigger: "schedule" });
    expect(s).toMatchObject({ autoApproved: 2, manualRequired: 1, awaitingApproval: 1, readyToSubmit: 2 });
    expect(calls.approved).toContain("app-j3");
  });

  it("never approves unverified documents", async () => {
    const { deps, calls } = setup([job(1)], { prepare: async (id) => ({ applicationId: `app-${id}`, verified: false }) });
    const s = await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(calls.approved).toEqual([]); expect(s.awaitingApproval).toBe(1);
  });

  it("a failing search does not stop scoring and preparing, and marks the run partial with the reason", async () => {
    const { m, deps, calls } = setup([job(1)], { scan: async () => { throw new Error("Adzuna rejected the credentials (401)"); } });
    const s = await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(calls.prepared).toEqual(["j1"]);
    expect(runRow(m)).toMatchObject({ status: "partial" });
    expect(String(runRow(m).error)).toMatch(/Adzuna rejected/);
    expect(m.t("activity_log").some((l) => l.kind === "scan.failed" && l.run_id === runRow(m).id)).toBe(true);
    expect(s.prepared).toBe(1);
  });

  it("one failed preparation is logged with the job and the rest continue", async () => {
    const { m, deps, calls } = setup([job(1), job(2), job(3)], { prepare: async (id) => { if (id === "j2") throw new Error("model timed out"); calls.prepared.push(id); return { applicationId: `app-${id}`, verified: true }; } });
    const s = await runPipeline(sched({ mode: "scan_prepare", require_approval: true }), deps, { trigger: "schedule" });
    expect(calls.prepared.sort()).toEqual(["j1", "j3"]);
    expect(s).toMatchObject({ prepared: 2, prepareFailed: 1 });
    const fail = m.t("activity_log").find((l) => l.kind === "application.prepare_failed")!;
    expect(fail).toMatchObject({ job_id: "j2", level: "error", company: "Co 2" });
    expect(runRow(m).status).toBe("partial");
  });

  it("stops preparing when no model is usable at all", async () => {
    const { deps, calls } = setup([job(1), job(2), job(3)], { prepare: async () => { calls.prepared.push("x"); throw new Error("All models failed: quota"); } });
    await runPipeline(sched({ mode: "scan_prepare" }), deps, { trigger: "schedule" });
    expect(calls.prepared.length).toBe(1);
  });

  it("gives up on a job that has failed to prepare too many times, and says so", async () => {
    const { m, deps, calls } = setup([job(1), job(2)], { failedPrepareAttempts: async (id) => (id === "j1" ? 3 : 0) });
    await runPipeline(sched({ mode: "scan_prepare" }), deps, { trigger: "schedule" });
    expect(calls.prepared).toEqual(["j2"]);
    expect(m.t("activity_log").some((l) => l.status === "gave_up" && l.job_id === "j1")).toBe(true);
  });

  it("stops at the time budget and reports it instead of running on", async () => {
    let t = 0;
    const { m, deps, calls } = setup([job(1), job(2), job(3)], { now: () => (t += 60_000) });
    const s = await runPipeline(sched({ mode: "scan_prepare" }), deps, { trigger: "schedule", budgetMs: 5 * 60_000 });
    expect(s.timedOut).toBe(true);
    expect(calls.prepared.length).toBeLessThan(3);
    expect(String(runRow(m).error)).toMatch(/Time limit/);
  });

  it("counts a refused approval and keeps going", async () => {
    const { m, deps } = setup([job(1), job(2)], { approve: async (id) => (id === "app-j2" ? { ok: false, status: 429, error: "Daily limit of 15 automated applications reached" } : { ok: true, mode: "automated", note: null }) });
    const s = await runPipeline(sched(), deps, { trigger: "schedule" });
    expect(s).toMatchObject({ autoApproved: 1, blocked: 1 });
    expect(runRow(m).status).toBe("partial");
  });

  it("a crash in a dependency still finalises the run as failed", async () => {
    const { m, deps } = setup([job(1)], { queuedJobs: async () => { throw new Error("database down"); } });
    await expect(runPipeline(sched(), deps, { trigger: "schedule" })).rejects.toThrow("database down");
    expect(runRow(m)).toMatchObject({ status: "failed" });
  });
});

describe("pipelineSummaryText", () => {
  it("lists what happened and links to the run", () => {
    const t = pipelineSummaryText("Morning", { runId: "r1", inserted: 5, scored: 5, matched: 3, prepared: 3, prepareFailed: 1, autoApproved: 1, manualRequired: 1, awaitingApproval: 1, blocked: 0, readyToSubmit: 1, timedOut: false, partial: false }, "https://x.app");
    expect(t).toContain("New jobs found: 5");
    expect(t).toContain("Waiting for your approval: 1");
    expect(t).toContain("Need you to press submit: 1");
    expect(t).toContain("https://x.app/logs/runs/r1");
  });
});

describe("clearing a backlog", () => {
  it("keeps scoring pass after pass while each pass makes progress, and stops when nothing is left", async () => {
    let backlog = 150; const passes: number[] = [];
    const { deps } = setup([]);
    deps.score = async () => { const n = Math.min(60, backlog); backlog -= n; passes.push(n); return { scored: n, queued: 0, skipped: 0, failed: 0 }; };
    const sum = await runPipeline({ id: "backlog", name: "Backlog", countries: [], integrations: [], mode: "scan", require_approval: true, max_prepare: 0, max_apply: 0 }, deps, { trigger: "schedule", skipScan: true });
    expect(passes).toEqual([60, 60, 30, 0]);
    expect(sum.scored).toBe(150);
  });
  it("does not search when only clearing the backlog", async () => {
    let scanned = false;
    const { deps } = setup([], { scan: async () => { scanned = true; } });
    await runPipeline({ id: "backlog", name: "Backlog", countries: [], integrations: ["adzuna"], mode: "scan", require_approval: true, max_prepare: 0, max_apply: 0 }, deps, { trigger: "schedule", skipScan: true });
    expect(scanned).toBe(false);
  });
});
