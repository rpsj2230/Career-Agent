import { beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateVerdict, externalAllowed, linkedinJobId, remainingFor, type ExternalLimits } from "@/lib/extension/external-rules";

const base: ExternalLimits = { auto: { allowed: true, remainingToday: 12, why: null }, linkedinEnabled: true, dailyLinkedin: 10, weeklyLinkedin: 40, linkedinToday: 3, linkedinWeek: 12 };

describe("Filter Auto Apply rules", () => {
  it("follows the Auto-Apply switch, pause and daily limit for every portal", () => {
    const off = { ...base, auto: { allowed: false, remainingToday: 0, why: "Auto-Apply is switched off in Career Agent (Settings)." } };
    expect(externalAllowed("naukri", off)).toEqual({ ok: false, why: "Auto-Apply is switched off in Career Agent (Settings).", global: true });
    expect(externalAllowed("linkedin", off)).toMatchObject({ ok: false, global: true });
    expect(externalAllowed("naukri", base)).toEqual({ ok: true });
  });
  it("applies LinkedIn's own switch, daily and weekly limits to LinkedIn only", () => {
    expect(externalAllowed("linkedin", { ...base, linkedinEnabled: false })).toMatchObject({ ok: false, global: true, why: expect.stringContaining("Allow automated LinkedIn Easy Apply") });
    expect(externalAllowed("linkedin", { ...base, linkedinToday: 10 })).toMatchObject({ ok: false, why: expect.stringContaining("LinkedIn limit of 10") });
    expect(externalAllowed("linkedin", { ...base, linkedinWeek: 40 })).toMatchObject({ ok: false, why: expect.stringContaining("week's LinkedIn limit of 40") });
    expect(externalAllowed("naukri", { ...base, linkedinEnabled: false, linkedinToday: 99 })).toEqual({ ok: true });
  });
  it("counts what may still go out: the smallest of the total, the day and the week", () => {
    expect(remainingFor("linkedin", base)).toBe(7);
    expect(remainingFor("linkedin", { ...base, weeklyLinkedin: 14 })).toBe(2);
    expect(remainingFor("linkedin", { ...base, auto: { ...base.auto, remainingToday: 4 } })).toBe(4);
    expect(remainingFor("naukri", base)).toBe(12);
    expect(remainingFor("linkedin", { ...base, linkedinEnabled: false })).toBe(0);
    expect(remainingFor("naukri", { ...base, auto: { allowed: false, remainingToday: 0, why: "x" } })).toBe(0);
  });
  it("never sends a job Career Agent already sent or that another worker is sending, but settles one that was waiting", () => {
    expect(duplicateVerdict(null)).toEqual({ ok: true });
    expect(duplicateVerdict({ status: "submitted" })).toMatchObject({ ok: false });
    expect(duplicateVerdict({ status: "approved" })).toMatchObject({ ok: false });
    expect(duplicateVerdict({ status: "submitting" })).toMatchObject({ ok: false });
    for (const s of ["prepared", "assisted_pending", "needs_input", "failed"]) expect(duplicateVerdict({ status: s })).toEqual({ ok: true });
  });
  it("reads the job number from a LinkedIn link", () => {
    expect(linkedinJobId("https://www.linkedin.com/jobs/view/4012345678/?refId=x")).toBe("4012345678");
    expect(linkedinJobId("https://www.linkedin.com/jobs/view/head-of-ops-at-acme-4012345678")).toBe("4012345678");
    expect(linkedinJobId("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&f_AL=true")).toBe("4012345678");
    expect(linkedinJobId("https://example.com/")).toBeNull();
  });
});

type Call = [string, unknown[]];
const world = {
  auto: { enabled: true }, caps: { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: true, company_cooldown_days: 14 },
  submitted: [] as { submitted_at: string; job: { portal: string; apply_type: string } }[],
  storedJob: null as { id: string } | null, app: null as { id: string; status: string } | null, recent: null as { title: string; at: string } | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[], updates: [] as { table: string; patch: Record<string, unknown> }[], events: [] as string[], marked: [] as unknown[],
};

function builder(table: string) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "gte", "ilike", "limit", "order", "maybeSingle", "insert", "update"]) b[m] = (...a: unknown[]) => { calls.push([m, a]); return b; };
  b.then = (ok: (v: unknown) => unknown) => {
    const ins = calls.find(([m]) => m === "insert");
    if (ins) { world.inserts.push({ table, row: ins[1][0] as Record<string, unknown> }); return Promise.resolve({ data: [{ id: table === "jobs" ? "job-new" : "app-new" }], error: null }).then(ok); }
    const upd = calls.find(([m]) => m === "update");
    if (upd) { world.updates.push({ table, patch: upd[1][0] as Record<string, unknown> }); return Promise.resolve({ data: [{ id: "app1" }], error: null }).then(ok); }
    if (table === "jobs") return Promise.resolve({ data: world.storedJob ? [world.storedJob] : [], error: null }).then(ok);
    if (table === "applications" && calls.some(([m, a]) => m === "select" && String(a[0]).includes("submitted_at"))) return Promise.resolve({ data: world.submitted, error: null }).then(ok);
    if (table === "applications") return Promise.resolve({ data: world.app, error: null }).then(ok);
    return Promise.resolve({ data: null, error: null }).then(ok);
  };
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({ from: builder }), must: (r: { data: unknown }) => r.data }));
vi.mock("@/lib/settings", () => ({ getSetting: async (k: string) => (k === "autoapply" ? world.auto : k === "caps" ? world.caps : { paused: false, since: "", until: "", note: "" }) }));
vi.mock("@/lib/apply/cooldown", () => ({ recentCompanyApplication: async () => world.recent }));
vi.mock("@/lib/apply/events", () => ({ logEvent: async (_id: string, kind: string) => { world.events.push(kind); } }));
vi.mock("@/lib/activity", () => ({ logActivity: async (e: { kind: string }) => { world.events.push(`activity:${e.kind}`); } }));
vi.mock("@/lib/activity-helpers", () => ({ jobLogFields: () => ({}) }));
vi.mock("@/lib/apply/mark-submitted", () => ({ markSubmitted: async (id: string, via: string, extra: unknown) => { world.marked.push([id, via, extra]); return { ok: true as const }; } }));
vi.mock("@/lib/schema", () => ({ withLegacyFallback: async (primary: () => PromiseLike<unknown>) => primary() }));

import { checkExternal, recordExternal } from "@/lib/extension/external";

const JOB = { portal: "linkedin" as const, company: "Acme Pte Ltd", title: "Head of Operations", url: "https://www.linkedin.com/jobs/view/4012345678/", jobKey: "4012345678", location: "Singapore" };

describe("the app's side of Filter Auto Apply", () => {
  beforeEach(() => {
    world.auto = { enabled: true }; world.caps = { daily_total: 15, daily_linkedin: 10, weekly_linkedin: 40, linkedin_automation_enabled: true, company_cooldown_days: 14 };
    world.submitted = []; world.storedJob = null; world.app = null; world.recent = null; world.inserts = []; world.updates = []; world.events = []; world.marked = [];
  });

  it("allows a new job and says how many more may go out", async () => {
    world.submitted = [{ submitted_at: new Date().toISOString(), job: { portal: "linkedin", apply_type: "linkedin" } }];
    expect(await checkExternal(JOB)).toEqual({ ok: true, remaining: 9 });
  });
  it("refuses for every job when LinkedIn's switch is off or the daily limit is used up", async () => {
    world.caps.linkedin_automation_enabled = false;
    expect(await checkExternal(JOB)).toMatchObject({ ok: false, global: true, error: expect.stringContaining("Allow automated LinkedIn Easy Apply") });
    world.caps.linkedin_automation_enabled = true;
    world.submitted = Array.from({ length: 10 }, () => ({ submitted_at: new Date().toISOString(), job: { portal: "linkedin", apply_type: "linkedin" } }));
    expect(await checkExternal(JOB)).toMatchObject({ ok: false, global: true, error: expect.stringContaining("limit of 10") });
  });
  it("counts yesterday's sends toward the week, not the day", async () => {
    world.submitted = Array.from({ length: 10 }, () => ({ submitted_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), job: { portal: "linkedin", apply_type: "linkedin" } }));
    expect(await checkExternal(JOB)).toEqual({ ok: true, remaining: 10 });
  });
  it("skips a job already sent, and a company applied to recently, without stopping the run", async () => {
    world.storedJob = { id: "job1" }; world.app = { id: "app1", status: "submitted" };
    expect(await checkExternal(JOB)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("already has this job as sent") });
    world.app = null; world.recent = { title: "Other role", at: "2026-10-20" };
    const r = await checkExternal(JOB);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("applied to Acme Pte Ltd recently") });
    expect((r as { global?: boolean }).global).toBeUndefined();
  });

  it("stores an unknown job and its application, and records the sending with the portal's confirmation", async () => {
    expect(await recordExternal(JOB, { outcome: "submitted", confirmation: "Your application was sent to Acme", finalUrl: JOB.url })).toEqual({ ok: true });
    const job = world.inserts.find((i) => i.table === "jobs")!.row;
    expect(job).toMatchObject({ source: "extension", external_id: "linkedin:4012345678", title: "Head of Operations", company: "Acme Pte Ltd", apply_type: "linkedin", portal: "linkedin", country: "sg" });
    expect(world.inserts.find((i) => i.table === "applications")!.row).toMatchObject({ job_id: "job-new", status: "assisted_pending" });
    expect(world.marked).toEqual([["app-new", "extension", { confirmation: "Your application was sent to Acme", finalUrl: JOB.url }]]);
  });
  it("uses the stored job and its waiting application when the scan already found it", async () => {
    world.storedJob = { id: "job1" }; world.app = { id: "app1", status: "assisted_pending" };
    await recordExternal(JOB, { outcome: "submitted" });
    expect(world.inserts).toEqual([]);
    expect(world.marked[0]).toMatchObject(["app1", "extension", { confirmation: expect.stringContaining("LinkedIn") }]);
  });
  it("records a job it could not finish as waiting for you, with the reason, and never undoes a sent one", async () => {
    await recordExternal(JOB, { outcome: "needs_input", note: "it asks Why do you want this role? and has no answer" });
    expect(world.inserts.find((i) => i.table === "applications")!.row).toMatchObject({ status: "needs_input", error: "Browser extension: it asks Why do you want this role? and has no answer" });
    expect(world.updates[0].patch).toMatchObject({ status: "needs_input" });
    expect(world.events).toContain("needs_input");
    world.inserts = []; world.updates = []; world.storedJob = { id: "job1" }; world.app = { id: "app1", status: "submitted" };
    expect(await recordExternal(JOB, { outcome: "needs_input", note: "later" })).toEqual({ ok: true });
    expect(world.updates).toEqual([]);
  });
});
