import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [string, unknown[]];
const world = {
  autoapply: { enabled: true }, caps: { daily_total: 15, company_cooldown_days: 14 }, pause: { paused: false, since: "", until: "", note: "" },
  submittedToday: 2, app: { id: "app1", job_id: "job1", status: "needs_input" } as { id: string; job_id: string; status: string } | null,
  recent: null as { title: string; at: string } | null, claimedRows: [{ id: "app1" }] as { id: string; job_id?: string }[],
  updates: [] as { table: string; patch: unknown; filters: Call[] }[], events: [] as string[],
};

/** A stand-in for the query builder: every call is recorded and the chain, when awaited, answers from `world`. */
function builder(table: string) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "limit", "order", "update", "maybeSingle"]) b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
  b.then = (ok: (v: unknown) => unknown) => {
    const upd = calls.find(([m]) => m === "update");
    if (upd) { world.updates.push({ table, patch: upd[1][0], filters: calls.filter(([m]) => m === "eq" || m === "in") }); return Promise.resolve({ data: world.claimedRows, error: null }).then(ok); }
    if (table === "applications" && calls.some(([m, a]) => m === "select" && (a[1] as { head?: boolean } | undefined)?.head)) return Promise.resolve({ count: world.submittedToday, error: null }).then(ok);
    if (table === "applications") return Promise.resolve({ data: world.app, error: null }).then(ok);
    if (table === "jobs") return Promise.resolve({ data: { id: "job1", title: "Head of Ops", company: "Cygnify" }, error: null }).then(ok);
    return Promise.resolve({ data: null, error: null }).then(ok);
  };
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({ from: builder }), must: (r: { data: unknown }) => r.data }));
vi.mock("@/lib/settings", () => ({ getSetting: async (k: string) => (k === "autoapply" ? world.autoapply : k === "caps" ? world.caps : world.pause) }));
vi.mock("@/lib/apply/cooldown", () => ({ recentCompanyApplication: async () => world.recent }));
vi.mock("@/lib/apply/events", () => ({ logEvent: async (_id: string, kind: string) => { world.events.push(kind); } }));
vi.mock("@/lib/activity", () => ({ logActivity: async (e: { kind: string }) => { world.events.push(`activity:${e.kind}`); } }));
vi.mock("@/lib/activity-helpers", () => ({ jobLogFields: () => ({}) }));

import { autoSubmitState, claimApplication, releaseApplication } from "@/lib/extension/claim";

describe("the app's side of automatic mode", () => {
  beforeEach(() => { world.autoapply = { enabled: true }; world.pause = { paused: false, since: "", until: "", note: "" }; world.submittedToday = 2; world.app = { id: "app1", job_id: "job1", status: "needs_input" }; world.recent = null; world.claimedRows = [{ id: "app1" }]; world.updates = []; world.events = []; });

  it("reports whether automatic submitting is allowed and how many are left today", async () => {
    expect(await autoSubmitState()).toEqual({ allowed: true, remainingToday: 13, why: null });
    world.autoapply = { enabled: false };
    expect(await autoSubmitState()).toMatchObject({ allowed: false });
  });
  it("claims an application only through the same rules as an automatic approval, and marks it as being worked on", async () => {
    expect(await claimApplication("app1")).toEqual({ ok: true });
    expect(world.updates[0].patch).toEqual({ status: "submitting", error: null });
    expect(JSON.stringify(world.updates[0].filters)).toContain("assisted_pending"); // only an application still waiting can be taken
    expect(world.events).toEqual(["worker_started", "activity:application.approved"]);
  });
  it("refuses, for every application, when the switch is off or the daily limit is used up, without touching anything", async () => {
    world.autoapply = { enabled: false };
    expect(await claimApplication("app1")).toMatchObject({ ok: false, status: 409, global: true });
    world.autoapply = { enabled: true }; world.submittedToday = 15;
    expect(await claimApplication("app1")).toMatchObject({ ok: false, global: true, error: expect.stringContaining("limit of 15") });
    expect(world.updates).toEqual([]);
  });
  it("refuses one application to a company applied to recently, and one that is no longer waiting, and says which", async () => {
    world.recent = { title: "Other role", at: "2026-10-20" };
    const r = await claimApplication("app1");
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("applied to Cygnify recently") });
    expect((r as { global?: boolean }).global).toBeUndefined();
    world.recent = null; world.claimedRows = []; world.app = { id: "app1", job_id: "job1", status: "submitted" };
    expect(await claimApplication("app1")).toMatchObject({ ok: false, error: "Already submitted" });
  });
  it("gives an application back to you with the reason, only if the extension was the one working on it", async () => {
    world.claimedRows = [{ id: "app1", job_id: "job1" }];
    expect(await releaseApplication("app1", "a captcha needs you")).toEqual({ ok: true });
    expect(world.updates[0].patch).toEqual({ status: "needs_input", error: "Browser extension: a captcha needs you" });
    expect(JSON.stringify(world.updates[0].filters)).toContain("submitting");
    world.claimedRows = [];
    expect(await releaseApplication("app1", "x")).toMatchObject({ ok: false, status: 409 });
  });
});
