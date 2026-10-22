import { describe, expect, it } from "vitest";
import { workersOverview, type WorkersInput } from "@/lib/workers-overview";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (min: number) => ({ at: new Date(now.getTime() - min * 60_000).toISOString() });
const base: WorkersInput = { now, computer: ago(1), oracle: { ...ago(2), portals: ["linkedin", "indeed", "naukri"] }, github: ago(30), cloud: { enabled: true, fallback_minutes: 90 }, started24h: { github: 12, oracle: 30, computer: 4 }, declined24h: { oracle: 3 } };
const row = (i: WorkersInput, id: string) => workersOverview(i).find((r) => r.id === id)!;

describe("workersOverview", () => {
  it("shows each worker's state from how recently it reported in", () => {
    expect(row(base, "computer").state).toBe("working");
    expect(row(base, "oracle").state).toBe("working");
    expect(row(base, "github").state).toBe("working"); // hourly, so 30 minutes is fine
    expect(row({ ...base, computer: ago(10) }, "computer").state).toBe("quiet");
    expect(row({ ...base, oracle: ago(30) }, "oracle").state).toBe("quiet");
    expect(row({ ...base, github: null }, "github").state).toBe("never");
    // GitHub's timer runs a few hours apart on a free account: between runs is normal, not a fault
    expect(row({ ...base, github: ago(150) }, "github").state).toBe("idle");
    expect(row({ ...base, github: ago(7 * 60) }, "github").state).toBe("idle");
    expect(row({ ...base, github: ago(9 * 60) }, "github").state).toBe("quiet");
  });
  it("shows the counts of the last 24 hours", () => {
    expect(row(base, "oracle")).toMatchObject({ started: 30, passedOn: 3 });
    expect(row(base, "computer").started).toBe(4);
  });
  it("tells the computer to leave the three portals to the always-on machine only while it reports in", () => {
    expect(row(base, "computer").handles.join(" ")).toMatch(/only if the always-on machine passes them on or stops/);
    const down = row({ ...base, oracle: ago(60) }, "computer").handles;
    expect(down).toEqual(expect.arrayContaining(["LinkedIn", "Indeed", "Naukri"]));
  });
  it("names the wait after which the computer takes employers' pages, and says the cloud workers are off when they are", () => {
    expect(row(base, "computer").handles.join(" ")).toContain("more than 90 minutes");
    const off = { ...base, cloud: { enabled: false, fallback_minutes: 90 } };
    expect(row(off, "github").state).toBe("off");
    expect(row(off, "github").handles[0]).toMatch(/Nothing while cloud workers are off/);
    expect(row(off, "computer").handles).toContain("Employers' own pages");
  });
});

describe("worker versions", () => {
  const base = { now: new Date("2026-10-22T10:00:00Z"), computer: null, oracle: null, github: null, cloud: { enabled: true, fallback_minutes: 90 }, started24h: {}, declined24h: {} } as WorkersInput;
  const at = "2026-10-22T09:59:00Z";
  it("says current, outdated or not reported, and nothing for a worker that was never seen", () => {
    const rows = (computer: WorkersInput["computer"], latest?: string) => workersOverview({ ...base, computer, latest }).find((r) => r.id === "computer")!.version;
    expect(rows({ at, version: "abc1234def" }, "abc1234def5678")).toMatchObject({ state: "current" });
    expect(rows({ at, version: "abc1234def" }, "fff0000")).toMatchObject({ state: "outdated", text: expect.stringContaining("update it") });
    expect(rows({ at }, "fff0000")).toMatchObject({ state: "unknown", text: expect.stringContaining("older than the version check") });
    expect(rows({ at, version: "abc1234def" }, undefined)).toMatchObject({ state: "unknown" });
    expect(rows(null, "fff0000")).toBeNull();
  });
});
