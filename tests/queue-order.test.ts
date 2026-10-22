import { describe, expect, it } from "vitest";
import { orderQueue, queuePriority } from "@/lib/apply/queue-order";

describe("which applications the assistant takes first", () => {
  it("ranks LinkedIn, Naukri, Indeed and employer application systems first, other employer pages next, job boards last", () => {
    expect(queuePriority({ portal: "linkedin", url: "https://www.linkedin.com/jobs/view/1" })).toBe(0);
    expect(queuePriority({ portal: "naukri" })).toBe(0);
    expect(queuePriority({ url: "https://boards.greenhouse.io/acme/jobs/1" })).toBe(0);
    expect(queuePriority({ apply_type: "lever" })).toBe(0);
    expect(queuePriority({ portal: "employer", url: "https://careers.acme.com/jobs/1", apply_type: "unknown" })).toBe(1);
    expect(queuePriority({ portal: "adzuna", url: "https://www.adzuna.com.au/details/1" })).toBe(2);
    expect(queuePriority({ url: "https://www.adzuna.com/land/ad/1" })).toBe(2);
    expect(queuePriority({ portal: "mycareersfuture" })).toBe(2);
  });
  it("keeps the oldest approval first within a group, so a round of 40 is not used up by Adzuna", () => {
    const jobs: Record<string, { portal: string; url?: string }> = {
      a1: { portal: "adzuna", url: "https://www.adzuna.com.au/details/1" }, a2: { portal: "adzuna", url: "https://www.adzuna.com.au/details/2" },
      l1: { portal: "linkedin" }, l2: { portal: "linkedin" }, e1: { portal: "employer", url: "https://x.example.com/job" },
    };
    const items = [{ id: "a1", approved_at: "2026-10-18" }, { id: "a2", approved_at: "2026-10-19" }, { id: "l2", approved_at: "2026-10-21" }, { id: "l1", approved_at: "2026-10-20" }, { id: "e1", approved_at: "2026-10-17" }];
    expect(orderQueue(items, (i) => jobs[i.id]).map((i) => i.id)).toEqual(["l1", "l2", "e1", "a1", "a2"]);
  });
  it("does not lose items whose job is unknown", () => {
    expect(orderQueue([{ id: "x", approved_at: null }], () => undefined)).toHaveLength(1);
  });
});
