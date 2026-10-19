import { describe, expect, it } from "vitest";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";

const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const pager = (rows: { id: number }[]) => async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null });

describe("fetchAll", () => {
  it("reads past the 1000-row limit of a single request", async () => {
    const r = await fetchAll(pager(table(2598)));
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2598);
    expect(new Set(r.data.map((x) => (x as { id: number }).id)).size).toBe(2598);
  });
  it("handles exact multiples of the page size and small tables", async () => {
    expect((await fetchAll(pager(table(2000)))).data).toHaveLength(2000);
    expect((await fetchAll(pager(table(0)))).data).toHaveLength(0);
    expect((await fetchAll(pager(table(7)))).data).toHaveLength(7);
  });
  it("stops at the maximum and passes an error on", async () => {
    expect((await fetchAll(pager(table(5000)), 3000)).data).toHaveLength(3000);
    const bad = await fetchAll(async (from) => (from === 0 ? { data: table(PAGE_SIZE), error: null } : { data: null, error: { message: "boom" } }));
    expect(bad.error?.message).toBe("boom");
  });
});
