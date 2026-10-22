import { describe, expect, it } from "vitest";
import { liveNow, NO_FORM, pushRecent, staleLinkedinNoForm, type Live, type Recent } from "@/lib/apply/assistant-live";
import { panelText } from "@/lib/apply/assistant-request";

const live: Live = { id: "a1", title: "Head of AI", company: "Acme", portal: "linkedin", step: "filling the form (page 2)", since: "2026-10-22T10:00:00Z" };
const now = new Date("2026-10-22T10:01:00Z");

describe("what the assistant is doing right now", () => {
  it("is shown only while the assistant is reporting in and the step is recent", () => {
    expect(liveNow({ at: "2026-10-22T10:00:40Z", live }, now)).toEqual(live);
    expect(liveNow({ at: "2026-10-22T09:50:00Z", live }, now)).toBeNull(); // the worker stopped reporting
    expect(liveNow({ at: "2026-10-22T10:00:40Z", live: { ...live, since: "2026-10-22T09:30:00Z" } }, now)).toBeNull(); // a crashed worker's old step
    expect(liveNow({ at: "2026-10-22T10:00:40Z" }, now)).toBeNull();
    expect(liveNow(null, now)).toBeNull();
  });
  it("reaches the panel, with the latest results only while online", () => {
    const recent: Recent[] = [{ at: "2026-10-22T10:00:00Z", title: "PM", company: "X", portal: "linkedin", outcome: "submitted" }];
    const on = panelText({ hb: { at: "2026-10-22T10:00:40Z", live, recent }, req: null, waiting: 5, now });
    expect(on.live?.id).toBe("a1");
    expect(on.recent).toHaveLength(1);
    const off = panelText({ hb: { at: "2026-10-22T09:00:00Z", live, recent }, req: null, waiting: 5, now });
    expect(off.live).toBeNull();
    expect(off.recent).toEqual([]);
  });
});

describe("recent results", () => {
  it("keeps the newest first, capped, with short single-line reasons", () => {
    let list: Recent[] = [];
    for (let i = 0; i < 15; i++) list = pushRecent(list, { at: `t${i}`, title: `Job ${i}`, company: "C", portal: "linkedin", outcome: "handed_back", note: `line one\n${"x".repeat(400)}` });
    expect(list).toHaveLength(12);
    expect(list[0].title).toBe("Job 14");
    expect(list[0].note!.length).toBeLessThanOrEqual(220);
    expect(list[0].note).not.toMatch(/\n/);
  });
});

describe("LinkedIn hand-backs caused by the signed-out page", () => {
  const portals = new Map<string, string | null>([["j1", "linkedin"], ["j2", "adzuna"], ["j3", "LinkedIn"]]);
  const apps = [
    { id: "a1", job_id: "j1", error: `${NO_FORM} on this page (it may need a sign-in)` },
    { id: "a2", job_id: "j2", error: `${NO_FORM} on this page` },
    { id: "a3", job_id: "j3", error: `${NO_FORM} on this page` },
    { id: "a4", job_id: "j1", error: "Needs you: Notice period" },
  ];
  it("are tried again once, for LinkedIn only", () => {
    expect(staleLinkedinNoForm(apps, portals, new Set())).toEqual(["a1", "a3"]);
    expect(staleLinkedinNoForm(apps, portals, new Set(["a1"]))).toEqual(["a3"]);
  });
});
