import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const logged: Row[] = [];
const alerts: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: async (e: Row) => { logged.push(e); } }));
vi.mock("@/lib/alerts", () => ({ alertOnce: async (_k: string, _h: number, m: string) => { alerts.push(m); return true; } }));
vi.mock("@/lib/integrations/credentials", () => ({ resolveCredentials: async () => ({ creds: {} }) }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => ({ enabled: true }) }));
vi.mock("@/lib/db", () => ({
  must: (r: { data?: unknown; error?: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; },
  db: () => ({
    from: (t: string) => {
      const filters: [string, unknown][] = [];
      let patch: Row | null = null, upsert: Row | null = null;
      const run = () => {
        if (upsert) { const i = (tables[t] ?? []).findIndex((r) => r.key === upsert!.key); if (i >= 0) tables[t][i] = upsert; else (tables[t] ??= []).push(upsert); return { data: [upsert], error: null }; }
        const rows = (tables[t] ?? []).filter((r) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
        if (patch) { rows.forEach((r) => Object.assign(r, patch)); return { data: rows, error: null }; }
        return { data: rows, error: null };
      };
      const c: Record<string, unknown> = {
        select: () => c, in: (k: string, v: unknown[]) => { filters.push([k, v]); return c; }, insert: (row: Row) => { (tables[t] ??= []).push(row); return { select: () => Promise.resolve({ data: [row], error: null }) }; }, eq: (k: string, v: unknown) => { filters.push([k, v]); return c; }, gte: () => c, limit: () => c, maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
        update: (p: Row) => { patch = p; return c; }, upsert: (p: Row) => { upsert = p; return c; }, then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
      };
      return c;
    },
  }),
}));

import { trackReplies } from "@/lib/mail/track";

const source = (mails: { from: string; subject: string; text: string; date?: Date; messageId: string }[]) => ({ fetchRecent: async () => [], fetchReplies: async () => mails });

beforeEach(() => {
  tables.applications = [
    { id: "a1", job_id: "j1", status: "submitted", lifecycle: "applied", submitted_at: "2026-10-01T00:00:00Z", job: { company: "Acme Pte Ltd" } },
    { id: "a2", job_id: "j2", status: "submitted", lifecycle: "applied", submitted_at: "2026-10-02T00:00:00Z", job: { company: "Globex" } },
  ];
  tables.settings = [];
  logged.length = 0; alerts.length = 0;
});

describe("trackReplies", () => {
  it("updates the application a reply is about, logs it, and tells you about interviews", async () => {
    const r = await trackReplies(source([
      { messageId: "<m1>", from: "Acme Recruiting <hr@acme.com>", subject: "Interview invitation", text: "We would like to schedule a call.", date: new Date("2026-10-10") },
      { messageId: "<m2>", from: "Globex <jobs@globex.com>", subject: "Your application", text: "Unfortunately we have decided to move forward with other candidates.", date: new Date("2026-10-11") },
      { messageId: "<m3>", from: "friend@gmail.com", subject: "Lunch?", text: "Free on Friday?" },
    ]));
    expect(r.updated.map((u) => [u.company, u.reply])).toEqual([["Acme Pte Ltd", "interview"], ["Globex", "rejected"]]);
    expect(tables.applications.map((a) => a.lifecycle)).toEqual(["interview", "rejected"]);
    expect(logged.map((l) => l.message)).toEqual(["Reply detected from Acme Pte Ltd: an interview invitation", "Reply detected from Globex: a rejection"]);
    expect(JSON.stringify(logged)).not.toMatch(/schedule a call|move forward/); // the body is never stored
    expect(alerts).toHaveLength(1); // interviews and offers are announced, rejections are not
    expect(alerts[0]).toMatch(/Acme.*interview invitation/);
  });
  it("never processes the same message twice", async () => {
    const mails = [{ messageId: "<m1>", from: "Acme <hr@acme.com>", subject: "Interview invitation", text: "We would like to schedule a call.", date: new Date("2026-10-10") }];
    await trackReplies(source(mails));
    logged.length = 0;
    const again = await trackReplies(source(mails));
    expect(again.checked).toBe(0);
    expect(logged).toEqual([]);
  });
  it("does nothing without a mailbox that can read replies", async () => {
    expect(await trackReplies({ fetchRecent: async () => [] })).toEqual({ checked: 0, updated: [] });
  });
  it("a mailbox failure never throws", async () => {
    await expect(trackReplies({ fetchRecent: async () => [], fetchReplies: async () => { throw new Error("IMAP down"); } })).resolves.toMatchObject({ updated: [] });
  });
});


describe("receipt emails confirm an application", () => {
  const receipt = (subject: string, from = "LinkedIn <jobs-noreply@linkedin.com>", date = new Date("2026-10-03T00:00:00Z")) => ({ from, subject, text: "Your application was sent.", date, messageId: `r-${subject}` });
  it("records the portal's receipt for the application it names, once", async () => {
    tables.apply_events = [];
    const r = await trackReplies(source([receipt("Your application was sent to Acme Pte Ltd"), receipt("Your application was sent to Acme Pte Ltd", undefined, new Date("2026-10-04T00:00:00Z"))].map((m, i) => ({ ...m, messageId: `m${i}` }))));
    expect(r.updated).toEqual([]); // a receipt is not a reply
    const events = tables.apply_events.filter((e) => e.kind === "receipt_confirmed");
    expect(events).toHaveLength(1);
    expect(events[0].application_id).toBe("a1");
    expect((events[0].detail as { from: string }).from).toBe("linkedin.com");
  });
  it("ignores a receipt that predates the application, or names no company of yours", async () => {
    tables.apply_events = [];
    await trackReplies(source([receipt("Your application was sent to Acme Pte Ltd", undefined, new Date("2026-09-01T00:00:00Z")), receipt("Your application was sent to Initech")]));
    expect(tables.apply_events.filter((e) => e.kind === "receipt_confirmed")).toHaveLength(0);
  });
});
