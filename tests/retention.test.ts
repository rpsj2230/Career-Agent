import { describe, expect, it, vi } from "vitest";

const calls: { table: string; op: string; args: unknown[] }[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getSetting: async () => ({ skipped_days: 30, log_days: 90 }) }));
vi.mock("@/lib/db", () => ({
  db: () => ({
    from: (table: string) => {
      const rec = { table, op: "", args: [] as unknown[] };
      calls.push(rec);
      const chain: Record<string, unknown> = {};
      const add = (name: string) => (...a: unknown[]) => { rec.args.push([name, ...a]); return chain; };
      for (const n of ["eq", "lt", "neq"]) chain[n] = add(n);
      chain.update = (v: unknown, o: unknown) => { rec.op = "update"; rec.args.push(["update", v, o]); const res = { error: null, count: 7 }; chain.then = (f: (v: unknown) => unknown) => Promise.resolve(res).then(f); return chain; };
      chain.delete = (o: unknown) => { rec.op = "delete"; rec.args.push(["delete", o]); const res = { error: null, count: 3 }; chain.then = (f: (v: unknown) => unknown) => Promise.resolve(res).then(f); return chain; };
      return chain;
    },
  }),
}));

import { applyRetention } from "@/lib/jobs/retention";

describe("retention", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("clears only old skipped descriptions and old rejection log lines", async () => {
    calls.length = 0;
    const r = await applyRetention(now);
    expect(r).toEqual({ trimmed: 7, logsDeleted: 3 });
    const jobs = calls.find((c) => c.table === "jobs")!;
    expect(jobs.args).toContainEqual(["update", { description: "" }, { count: "exact" }]);
    expect(jobs.args).toContainEqual(["eq", "status", "skipped"]);
    expect(jobs.args).toContainEqual(["lt", "found_at", "2026-05-02T00:00:00.000Z"]);
    const log = calls.find((c) => c.table === "activity_log")!;
    expect(log.args).toContainEqual(["eq", "kind", "job.rejected"]);
    expect(log.args).toContainEqual(["lt", "created_at", "2026-03-03T00:00:00.000Z"]);
  });
  it("0 switches a rule off", async () => {
    calls.length = 0;
    expect(await applyRetention(now, { skipped_days: 0, log_days: 0 })).toEqual({ trimmed: 0, logsDeleted: 0 });
    expect(calls).toHaveLength(0);
  });
});
