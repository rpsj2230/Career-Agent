import { describe, expect, it } from "vitest";
import { changedSince, fmtBytes, shortHash, submissionView, summariseDiff } from "@/lib/apply/detail";
import { assistedRecord, confirmationSnippet } from "@/lib/apply/submission";
import { CONFIRMATION } from "../worker/match";

describe("summariseDiff", () => {
  it("counts reworded and untouched bullets", () => {
    expect(summariseDiff([{ experienceId: "e", tailored: "a", original: ["a"], changed: false }, { experienceId: "e", tailored: "b", original: ["c"], changed: true }])).toEqual({ total: 2, changed: 1, kept: 1 });
  });
  it("copes with no diff (older applications)", () => expect(summariseDiff(null)).toEqual({ total: 0, changed: 0, kept: 0 }));
});

describe("changedSince", () => {
  it("lists only fields that differ from the snapshot", () => {
    expect(changedSince({ title: "PM", company: "A", description: "old" }, { title: "PM", company: "A", description: "new" })).toEqual(["description"]);
    expect(changedSince({ title: "PM" }, { title: "PM" })).toEqual([]);
  });
  it("treats missing and null as equal, and has nothing to compare without a snapshot", () => {
    expect(changedSince({ location: null }, {})).toEqual([]);
    expect(changedSince(null, { title: "x" })).toEqual([]);
  });
});

describe("submissionView", () => {
  it("returns a stored record", () => {
    const v = submissionView({ status: "submitted", submission: assistedRecord("https://x", new Date("2026-10-16T00:00:00Z")) });
    expect(v.kind).toBe("record");
  });
  it("says 'not submitted' for pending applications and 'no record' for older finished ones", () => {
    expect(submissionView({ status: "prepared" })).toEqual({ kind: "none", reason: "not_submitted" });
    expect(submissionView({ status: "submitted", submission: null })).toEqual({ kind: "none", reason: "no_record" });
    expect(submissionView({ status: "failed", submission: { junk: true } })).toEqual({ kind: "none", reason: "no_record" });
  });
});

describe("confirmationSnippet", () => {
  it("returns the text around the employer's confirmation", () => {
    const page = "Header ".repeat(40) + "Thank you for applying! We will be in touch." + " Footer".repeat(100);
    const s = confirmationSnippet(page, CONFIRMATION);
    expect(s).toContain("Thank you for applying");
    expect(s.length).toBeLessThanOrEqual(400);
  });
  it("falls back to the start of the page when nothing matches", () => expect(confirmationSnippet("Hello   world", /zzz/)).toBe("Hello world"));
});

describe("formatting", () => {
  it("abbreviates hashes and sizes", () => {
    expect(shortHash("a".repeat(64))).toBe("aaaaaaaa…aaaaaa");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
