import { beforeEach, describe, expect, it, vi } from "vitest";
import { dedupeKey } from "@/lib/jobs/normalize";
import { freshnessBonus, rankScore } from "@/lib/pipeline/rank";
import { MasterProfile } from "@/lib/types";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const logged: Row[] = [];
let openAnswer: { open: boolean | null; reason?: string } = { open: true };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: async (e: Row) => { logged.push(e); } }));
vi.mock("@/lib/jobs/posting", () => ({ checkPostingOpen: async () => openAnswer, isReadablePage: () => true, fetchJobText: async () => null }));
vi.mock("@/lib/score/enrich", () => ({ enrichIfThin: async () => null }));
vi.mock("@/lib/db", () => ({
  must: (r: { data?: unknown; error?: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; },
  db: () => ({
    from: (t: string) => {
      const filters: [string, string, unknown][] = [];
      let patch: Row | null = null;
      const run = () => {
        const rows = (tables[t] ?? []).filter((r) => filters.every(([op, k, v]) => (op === "eq" ? r[k] === v : r[k] !== v)));
        if (patch) { rows.forEach((r) => Object.assign(r, patch)); return { data: rows, error: null }; }
        return { data: rows, error: null };
      };
      const c: Record<string, unknown> = {
        select: () => c, eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return c; }, neq: (k: string, v: unknown) => { filters.push(["neq", k, v]); return c; }, limit: () => c,
        update: (p: Row) => { patch = p; return c; }, then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
      };
      return c;
    },
  }),
}));

import { PreflightStop, preflight } from "@/lib/apply/preflight";

const profile = MasterProfile.parse({ basics: { headline: "PM" }, preferences: { countries: ["sg"], roles: ["Product Manager"] }, experience: [{ id: "e", company: "A", title: "PM", bullets: [] }] });
const job = (o: Row = {}) => ({ id: "j1", title: "Product Manager", company: "Acme Pte Ltd", url: "https://careers.acme.com/1", description: "Own the roadmap. ".repeat(20), country: "sg", location: "Singapore", salary_text: null, source: "adzuna", ...o });
const KEY = dedupeKey("Acme Pte Ltd", "Product Manager", "sg");
const opts = { profile, blocklist: { companies: [], keywords: [], skip_agencies: false } };

beforeEach(() => { tables.jobs = [{ id: "j1", status: "queued", skip_reason: null, dedupe_key: KEY }]; logged.length = 0; openAnswer = { open: true }; });

describe("preflight", () => {
  it("lets a normal job through", async () => {
    await expect(preflight(job(), opts)).resolves.toBeUndefined();
    expect(tables.jobs[0].status).toBe("queued");
  });
  it("closes out a posting that is gone, with the reason, and stops", async () => {
    openAnswer = { open: false, reason: "The posting page returned 404 (removed)" };
    await expect(preflight(job(), opts)).rejects.toMatchObject({ name: "PreflightStop", code: "closed" });
    expect(tables.jobs[0]).toMatchObject({ status: "skipped" });
    expect(String(tables.jobs[0].skip_reason)).toMatch(/no longer open/);
    expect(logged.some((l) => l.status === "closed")).toBe(true);
  });
  it("a page that cannot be read never blocks", async () => {
    openAnswer = { open: null };
    await expect(preflight(job(), opts)).resolves.toBeUndefined();
  });
  it("checks the rules again on the full text", async () => {
    await expect(preflight(job({ description: "This is an UNPAID trial. " + "x".repeat(200) }), { ...opts, blocklist: { companies: [], keywords: ["unpaid"], skip_agencies: false } })).rejects.toMatchObject({ code: "no_longer_fits" });
    expect(String(tables.jobs[0].skip_reason)).toMatch(/no longer fits/);
  });
  it("stops when you already applied for the same role through another listing", async () => {
    tables.jobs.push({ id: "j2", dedupe_key: KEY, applications: [{ status: "submitted" }] });
    const e = await preflight(job(), opts).catch((x) => x);
    expect(e).toBeInstanceOf(PreflightStop);
    expect(e.code).toBe("already_applied");
  });
  it("an earlier application that was only prepared, or for another role, does not block", async () => {
    tables.jobs.push({ id: "j2", dedupe_key: KEY, applications: [{ status: "prepared" }] }, { id: "j3", dedupe_key: dedupeKey("Acme Pte Ltd", "Analyst", "sg"), applications: [{ status: "submitted" }] });
    await expect(preflight(job(), opts)).resolves.toBeUndefined();
  });
});

describe("freshness ranking", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
  it("gives newer postings a small lead and older ones a small penalty", () => {
    expect([1, 5, 10, 20, 60].map((d) => freshnessBonus(ago(d), now))).toEqual([6, 3, 0, -3, -6]);
    expect(freshnessBonus(null, now)).toBe(0);
    expect(freshnessBonus("not a date", now)).toBe(0);
  });
  it("fit still comes first when the gap is large", () => {
    expect(rankScore(90, ago(40), now)).toBeGreaterThan(rankScore(76, ago(1), now));
    expect(rankScore(80, ago(1), now)).toBeGreaterThan(rankScore(82, ago(40), now));
  });
});
