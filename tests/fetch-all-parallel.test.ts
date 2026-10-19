import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";

const source = (total: number, failAt?: number) => {
  const calls: number[] = [];
  const page = async (from: number, to: number) => {
    calls.push(from);
    if (failAt !== undefined && from === failAt) return { data: null, error: { message: "boom" } };
    const rows = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({ n: from + i }));
    return { data: rows, error: null };
  };
  return { page, calls };
};

describe("fetchAll", () => {
  it("returns every row once, in order, for sizes around the page and batch boundaries", async () => {
    for (const total of [0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, 4 * PAGE_SIZE, 4 * PAGE_SIZE + 1, 9 * PAGE_SIZE + 5]) {
      const s = source(total);
      const r = await fetchAll<{ n: number }>(s.page);
      expect(r.error).toBeNull();
      expect(r.data.map((x) => x.n)).toEqual(Array.from({ length: total }, (_, i) => i));
    }
  });
  it("stops at the maximum", async () => {
    const r = await fetchAll<{ n: number }>(source(100_000).page, 3 * PAGE_SIZE);
    expect(r.data.length).toBe(3 * PAGE_SIZE);
  });
  it("reports an error and keeps what came before it", async () => {
    const r = await fetchAll<{ n: number }>(source(10 * PAGE_SIZE, 2 * PAGE_SIZE).page);
    expect(r.error?.message).toBe("boom");
    expect(r.data.length).toBe(2 * PAGE_SIZE);
  });
});
