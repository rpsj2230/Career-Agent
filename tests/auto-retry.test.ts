import { describe, expect, it } from "vitest";
import { isRetryable, MAX_AUTO_RETRIES, pickRetries } from "@/lib/apply/auto-retry";

describe("isRetryable", () => {
  it("retries what a second try can fix", () => {
    expect(isRetryable("LinkedIn automation needs a signed-in LinkedIn session for this profile (LINKEDIN_STORAGE_STATE is the main profile's); apply through the local assistant instead")).toBe(true);
    expect(isRetryable("page.goto: Timeout 45000ms exceeded")).toBe(true);
    expect(isRetryable("net::ERR_CONNECTION_RESET")).toBe(true);
    expect(isRetryable("The worker stopped before finishing")).toBe(true);
    expect(isRetryable(null)).toBe(true);
    expect(isRetryable("")).toBe(true);
  });
  it("does not retry what a second try cannot fix", () => {
    expect(isRetryable("You already applied to this job")).toBe(false);
    expect(isRetryable("This role is no longer available (closed)")).toBe(false);
    expect(isRetryable("The page shows a CAPTCHA; please do this one yourself")).toBe(false);
    expect(isRetryable("A security check appeared")).toBe(false);
    expect(isRetryable("Some other unexplained error")).toBe(false);
  });
});

describe("pickRetries", () => {
  const rows = [1, 2, 3, 4].map((i) => ({ id: `a${i}`, job_id: `j${i}`, error: i === 3 ? "closed" : "Timeout 30000ms exceeded" }));
  it("skips unfixable failures and applications already tried the most often", () => {
    const picked = pickRetries(rows, new Map([["a2", MAX_AUTO_RETRIES], ["a4", 1]]));
    expect(picked.map((r) => r.id)).toEqual(["a1", "a4"]);
  });
  it("is capped per round, oldest first", () => {
    expect(pickRetries(rows, new Map(), { limit: 1 }).map((r) => r.id)).toEqual(["a1"]);
  });
});
