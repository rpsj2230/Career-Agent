import { describe, expect, it } from "vitest";
import { markReviewed, needsReview } from "../src/lib/tailor/review";
import { tagsFor, type LibraryRow } from "../src/lib/tailor/library";

const flagged = { ok: false, attempts: 2, issues: [{ where: "experience.exp1", problem: "the number 40 is not in your profile" }, { where: "summary", problem: "'Kubernetes' is not in your profile" }] };

describe("reviewing a resume the checker flagged", () => {
  it("is needed only when the check did not pass", () => {
    expect(needsReview(flagged)).toBe(true);
    expect(needsReview({ ok: true })).toBe(false);
    expect(needsReview(null)).toBe(false);
  });
  it("clears the flag, keeps the flagged claims on record, and says it was you", () => {
    const r = markReviewed(flagged, new Date("2026-10-23T01:00:00Z"));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual(flagged.issues);
    expect(r.attempts).toBe(2);
    expect(r.reviewed).toEqual({ by: "you", at: "2026-10-23T01:00:00.000Z", issues: 2 });
  });
  it("removes the 'needs review' tag from the list", () => {
    const row = (verified: boolean): LibraryRow => ({ documentId: "d", jobId: "j", title: "Business Project Manager", company: "Acme", country: "sg", createdAt: "", version: 1, storagePath: "p", verified, style: "standard", mode: "fresh", sourceTitle: null, lifecycle: "none", usedAgain: 0 });
    expect(tagsFor(row(false))).toContain("needs review");
    expect(tagsFor(row(true))).not.toContain("needs review");
  });
});
