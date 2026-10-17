import { describe, expect, it } from "vitest";
import { assistantVerdict } from "@/lib/apply/assistant-verdict";
import { judge, pickProbes, report } from "../worker/canary-lib";

const now = new Date("2026-03-10T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = { handsFree: true, waiting: 2, oldestWaiting: ago(6), now, localHour: 14 };

describe("assistantVerdict", () => {
  it("is silent when nothing waits and it never reported", () => {
    expect(assistantVerdict({ ...base, waiting: 0, oldestWaiting: null, heartbeat: null }).relevant).toBe(false);
  });
  it("flags offline when work waits and the heartbeat is old", () => {
    const v = assistantVerdict({ ...base, heartbeat: { at: ago(8) } });
    expect(v.offline).toBe(true);
    expect(v.text).toMatch(/2 applications are waiting/);
  });
  it("is fine when it reported recently", () => {
    expect(assistantVerdict({ ...base, heartbeat: { at: ago(0.5) } }).offline).toBe(false);
  });
  it("flags a hands-free setup that never reported in", () => {
    const v = assistantVerdict({ ...base, heartbeat: null });
    expect(v.offline).toBe(true);
    expect(v.text).toMatch(/never reported/);
  });
  it("does not nag outside the working hours it was given", () => {
    expect(assistantVerdict({ ...base, localHour: 3, heartbeat: { at: ago(8), hours: "9-18" } }).offline).toBe(false);
  });
  it("does not nag for a brand new application", () => {
    expect(assistantVerdict({ ...base, oldestWaiting: ago(0.2), heartbeat: { at: ago(8) } }).offline).toBe(false);
  });
  it("does not nag people who apply by hand (not hands-free, not watching)", () => {
    expect(assistantVerdict({ ...base, handsFree: false, heartbeat: { at: ago(8) } }).offline).toBe(false);
  });
});

describe("canary helpers", () => {
  const urls = [
    "https://boards.greenhouse.io/acme/jobs/1", "https://boards.greenhouse.io/acme/jobs/2",
    "https://boards.greenhouse.io/beta/jobs/3", "https://boards.greenhouse.io/gamma/jobs/4",
    "https://jobs.lever.co/zed/abc", "https://www.linkedin.com/jobs/view/1", "https://example.com/x",
  ];
  it("picks one per company, capped per system, automatic systems only", () => {
    const p = pickProbes(urls, 2);
    expect(p.filter((x) => x.ats === "greenhouse")).toHaveLength(2);
    expect(p.map((x) => x.url)).not.toContain("https://boards.greenhouse.io/acme/jobs/2");
    expect(p.some((x) => x.ats === "lever")).toBe(true);
    expect(p).toHaveLength(3);
  });
  it("calls a system broken only when no probe worked", () => {
    const v = judge([
      { ats: "greenhouse", url: "a", opened: "clicked", fields: 6 }, { ats: "greenhouse", url: "b", opened: "error", fields: 0 },
      { ats: "lever", url: "c", opened: "none", fields: 0 },
    ]);
    expect(v.find((x) => x.ats === "greenhouse")?.broken).toBe(false);
    expect(v.find((x) => x.ats === "lever")?.broken).toBe(true);
    expect(report(v)).toMatch(/found a problem.*lever/);
    expect(report([])).toMatch(/no recent postings/);
  });
});
