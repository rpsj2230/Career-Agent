import { describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const logged: Row[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: async (e: Row) => { logged.push(e); } }));
vi.mock("@/lib/db", () => ({
  db: () => ({
    from: (t: string) => {
      const filters: [string, unknown][] = [];
      let op = "select", patch: Row = {}, orderDesc = false, lim = 1000;
      const run = () => {
        let rows = (tables[t] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        if (op === "insert") { (tables[t] ??= []).push(patch); return { data: [patch], error: null }; }
        if (op === "update") { rows.forEach((r) => Object.assign(r, patch)); return { data: rows, error: null }; }
        if (orderDesc) rows = [...rows].sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return { data: rows.slice(0, lim), error: null };
      };
      const c: Record<string, unknown> = {
        select: () => c, eq: (k: string, v: unknown) => { filters.push([k, v]); return c; }, order: (_k: string, o: { ascending: boolean }) => { orderDesc = !o.ascending; return c; }, limit: (n: number) => { lim = n; return c; },
        update: (p: Row) => { op = "update"; patch = p; return c; }, insert: (p: Row) => { op = "insert"; patch = p; return c; },
        then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
      };
      return c;
    },
  }),
}));

import { reapStuckApplications } from "@/lib/apply/reaper";

const now = new Date("2026-10-17T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("reapStuckApplications", () => {
  it("hands back an application whose worker stopped long ago, and leaves a recent or finished one alone", async () => {
    tables.applications = [
      { id: "old", job_id: "j1", status: "submitting", approved_at: ago(300) },
      { id: "fresh", job_id: "j2", status: "submitting", approved_at: ago(300) },
      { id: "done", job_id: "j3", status: "submitted", approved_at: ago(300) },
    ];
    tables.apply_events = [{ application_id: "old", kind: "worker_started", at: ago(120) }, { application_id: "fresh", kind: "worker_started", at: ago(5) }];
    const n = await reapStuckApplications(75, now);
    expect(n).toBe(1);
    const row = (id: string) => tables.applications.find((a) => a.id === id)!;
    expect(row("old")).toMatchObject({ status: "needs_input" });
    expect(String(row("old").error)).toMatch(/Check the employer's site/);
    expect(row("fresh").status).toBe("submitting");
    expect(row("done").status).toBe("submitted");
    expect(logged.some((l) => l.kind === "application.needs_input" && l.application_id === "old")).toBe(true);
    expect(tables.apply_events.some((e) => e.application_id === "old" && e.kind === "needs_input")).toBe(true);
  });
  it("uses the approval time when the worker never recorded a start", async () => {
    tables.applications = [{ id: "x", job_id: "j", status: "submitting", approved_at: ago(200) }];
    tables.apply_events = [];
    expect(await reapStuckApplications(75, now)).toBe(1);
  });
  it("does nothing when nothing is stuck", async () => {
    tables.applications = [];
    expect(await reapStuckApplications(75, now)).toBe(0);
  });
});
