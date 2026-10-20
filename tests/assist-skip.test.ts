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
