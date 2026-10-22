import { describe, expect, it } from "vitest";
import { DEFER_ROUNDS, deferredMessage, isTransient, shouldDefer, withRetries } from "@/lib/apply/resume-retry";

const instant = async () => undefined;

describe("trying the resume again before using the master resume", () => {
  it("retries a rate-limited or busy model after each wait, then succeeds", async () => {
    let calls = 0; const waited: number[] = [];
    const out = await withRetries(async () => { calls++; if (calls < 3) throw new Error("All models failed: 429 rate limit"); return "resume"; }, { waits: [15_000, 45_000], sleep: async (ms) => { waited.push(ms); } });
    expect(out).toBe("resume");
    expect(calls).toBe(3);
    expect(waited).toEqual([15_000, 45_000]);
  });
  it("gives up with the last error once the waits are used", async () => {
    let calls = 0;
    await expect(withRetries(async () => { calls++; throw new Error("No model available"); }, { waits: [1, 2], sleep: instant })).rejects.toThrow("No model available");
    expect(calls).toBe(3);
  });
  it("does not retry an error a later try cannot fix", async () => {
    let calls = 0;
    await expect(withRetries(async () => { calls++; throw new Error("The profile has no experience"); }, { waits: [1, 2], sleep: instant })).rejects.toThrow("no experience");
    expect(calls).toBe(1);
  });
  it("reports each retry", async () => {
    const seen: number[] = [];
    let n = 0;
    await withRetries(async () => { if (n++ < 1) throw new Error("timed out"); return 1; }, { waits: [1], sleep: instant, onRetry: (a) => seen.push(a) });
    expect(seen).toEqual([1]);
  });
  it("knows transient errors", () => {
    for (const m of ["429 Too Many Requests", "Request timed out", "Service unavailable (503)", "model is overloaded", "quota exceeded"]) expect(isTransient(m)).toBe(true);
    expect(isTransient("The profile has no experience")).toBe(false);
  });
});

describe("when the master resume is finally used", () => {
  it("defers for the first rounds, then lets the master resume in", () => {
    expect(DEFER_ROUNDS).toBe(2);
    expect([0, 1, 2, 3].map(shouldDefer)).toEqual([true, true, false, false]);
  });
  it("says which attempt it is and what happens after", () => {
    const m = deferredMessage("429 rate limit", 0);
    expect(m).toMatch(/tried again next round \(attempt 1 of 3\)/);
    expect(m).toMatch(/master resume/);
  });
});
