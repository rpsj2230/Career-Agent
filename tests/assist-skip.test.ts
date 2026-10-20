import { describe, expect, it } from "vitest";
import { isSkipped, skipPortals } from "../worker/assist-skip";

describe("ASSIST_SKIP", () => {
  it("parses a list and matches the portal or the source, ignoring case", () => {
    expect(skipPortals(" Naukri, shine ;")).toEqual(["naukri", "shine"]);
    expect(skipPortals(undefined)).toEqual([]);
    expect(isSkipped(["naukri"], { portal: "Naukri", source: "alert-email" })).toBe(true);
    expect(isSkipped(["naukri"], { portal: null, source: "naukri-mail" })).toBe(true);
    expect(isSkipped(["naukri"], { portal: "LinkedIn", source: "apify" })).toBe(false);
    expect(isSkipped([], { portal: "Naukri" })).toBe(false);
  });
});

import { isWanted } from "../worker/assist-skip";
describe("employer pages and the cloud assistant", () => {
  const employer = { portal: "adzuna", source: "adzuna", apply_type: "unknown" };
  const linkedin = { portal: "linkedin", source: "apify:x", apply_type: "linkedin" };
  it("splits the work so each application belongs to exactly one assistant", () => {
    const local = ["employer"], cloud = ["employer"];
    for (const job of [employer, linkedin, { portal: "naukri", apply_type: "portal" }, { portal: "greenhouse", apply_type: "greenhouse" }]) {
      expect(!isSkipped(local, job) !== isWanted(cloud, job)).toBe(true); // the computer does it exactly when the cloud does not
    }
    expect(isWanted(cloud, employer)).toBe(true);
    expect(isWanted(cloud, linkedin)).toBe(false);
    expect(isSkipped(local, linkedin)).toBe(false);
  });
  it("wants everything when no filter is given", () => { expect(isWanted([], linkedin)).toBe(true); });
});

import { takeable } from "../worker/assist-skip";
describe("hand-over between workers", () => {
  const employer = { portal: "adzuna", apply_type: "unknown" };
  const linkedin = { portal: "linkedin", apply_type: "linkedin" };
  const now = Date.parse("2026-10-20T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const computer = { skip: [] as string[], only: [] as string[], defer: ["employer"], deferMs: 90 * 60_000, now };
  const cloud = { skip: [] as string[], only: ["employer"], defer: [] as string[], deferMs: 0, now };

  it("the cloud worker takes employer pages at once and never anything else", () => {
    expect(takeable(employer, ago(1), cloud)).toBe(true);
    expect(takeable(linkedin, ago(500), cloud)).toBe(false);
  });
  it("the computer leaves a fresh employer page to the cloud, and takes it over once it has waited too long", () => {
    expect(takeable(employer, ago(10), computer)).toBe(false);
    expect(takeable(employer, ago(89), computer)).toBe(false);
    expect(takeable(employer, ago(91), computer)).toBe(true);
    expect(takeable(employer, null, computer)).toBe(true);
  });
  it("the computer always takes what only it can do", () => {
    expect(takeable(linkedin, ago(0), computer)).toBe(true);
  });
  it("a skipped portal is never taken, however long it waits", () => {
    expect(takeable(linkedin, ago(9999), { ...computer, skip: ["linkedin"] })).toBe(false);
  });
});
