import { describe, expect, it } from "vitest";
import { channelOf, reasonsOf, summariseApply, type AttemptRow } from "@/lib/apply/stats";

const row = (o: Partial<AttemptRow>): AttemptRow => ({ status: "submitted", method: "automated", error: null, portal: "greenhouse", url: "https://boards.greenhouse.io/acme/jobs/1", apply_type: "greenhouse", ...o });

describe("channels", () => {
  it("names the ATS from the link, otherwise the portal", () => {
    expect(channelOf({ portal: "adzuna", url: "https://jobs.ashbyhq.com/ramp/1", apply_type: "portal" })).toEqual({ channel: "ashby", label: "Ashby" });
    expect(channelOf({ portal: "naukri", url: "https://www.naukri.com/job-listings-x-1", apply_type: "portal" })).toEqual({ channel: "naukri", label: "Naukri" });
    expect(channelOf({ portal: null, url: null, apply_type: "lever" })).toEqual({ channel: "lever", label: "Lever" });
  });
});

describe("reasons", () => {
  it("lists each unanswered question separately, without form decorations", () => {
    expect(reasonsOf("Needs you: Notice period (required); Favourite colour", "needs_input")).toEqual(["Needs an answer: Notice period", "Needs an answer: Favourite colour"]);
  });
  it("makes technical errors comparable", () => {
    const a = reasonsOf('Could not download 3f2b8c1a-1234-5678-9abc-def012345678/resume-v2.docx: "x"', "failed");
    const b = reasonsOf('Could not download aaaaaaaa-1234-5678-9abc-def012345678/resume-v9.docx: "y"', "failed");
    expect(a).toEqual(b);
    expect(reasonsOf(null, "failed")).toEqual(["Failed without a message"]);
  });
});

describe("summariseApply", () => {
  const rows = [
    row({}), row({}), row({}),
    row({ status: "needs_input", error: "Needs you: Notice period" }),
    row({ status: "needs_input", error: "Needs you: Notice period" }),
    row({ status: "failed", error: "No application form was found on this page", method: "automated" }),
    row({ portal: "naukri", url: "https://www.naukri.com/job-listings-x-1", apply_type: "portal", method: "assisted" }),
    row({ status: "prepared" }), // not an attempt yet
  ];
  const s = summariseApply(rows);
  it("counts outcomes per channel, most active first, with the success rate", () => {
    expect(s.map((c) => [c.channel, c.attempts, c.submitted, c.needsYou, c.failed, c.rate])).toEqual([["greenhouse", 6, 3, 2, 1, 50], ["naukri", 1, 1, 0, 0, 100]]);
    expect(s[0].automated).toBe(6);
  });
  it("shows why applications stopped, most common first", () => {
    expect(s[0].topReasons[0]).toEqual({ reason: "Needs an answer: Notice period", count: 2 });
    expect(s[0].topReasons[1].reason).toMatch(/No application form was found/);
  });
  it("is empty with nothing to count", () => expect(summariseApply([])).toEqual([]));
});
