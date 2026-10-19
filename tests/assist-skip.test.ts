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
