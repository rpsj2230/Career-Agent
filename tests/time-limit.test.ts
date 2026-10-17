import { describe, expect, it } from "vitest";
import { within } from "@/lib/time-limit";

describe("within: a reply always goes out by the deadline", () => {
  it("returns the work's result when it finishes in time", async () => {
    expect(await within(Promise.resolve("done"), 500, () => "late")).toBe("done");
  });
  it("returns the late answer, on time, when the work is still running", async () => {
    const t0 = Date.now();
    const r = await within(new Promise<string>((res) => setTimeout(() => res("slow"), 3_000)), 100, () => "late");
    expect(r).toBe("late");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  it("a failing job still rejects normally when it fails before the deadline", async () => {
    await expect(within(Promise.reject(new Error("boom")), 500, () => "late")).rejects.toThrow("boom");
  });
});
