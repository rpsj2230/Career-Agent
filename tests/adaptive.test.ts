import { describe, expect, it } from "vitest";
import { effectiveIntervalHours, idleStreak, silentDrop, suggestTitles } from "@/lib/jobs/adaptive";

describe("adaptive search interval", () => {
  it("is the base gap while a search is paying off, and doubles every three empty runs up to a day", () => {
    expect([0, 1, 2, 3, 5, 6, 9, 12, 30].map((n) => effectiveIntervalHours(6, n))).toEqual([6, 6, 6, 12, 12, 24, 24, 24, 24]);
  });
  it("0 means always search; a base above a day is kept", () => {
    expect(effectiveIntervalHours(0, 10)).toBe(0);
    expect(effectiveIntervalHours(48, 0)).toBe(48);
  });
  it("counts leading empty runs only", () => {
    expect(idleStreak([{ inserted: 0 }, { inserted: 0 }, { inserted: 4 }, { inserted: 0 }])).toBe(2);
    expect(idleStreak([{ inserted: 1 }])).toBe(0);
    expect(idleStreak([])).toBe(0);
  });
});

describe("suggestTitles", () => {
  const configured = ["Product Manager"];
  it("suggests titles that keep showing up in matches but are not searched", () => {
    const matched = ["Product Owner", "Senior Product Owner", "Product Owner (Payments)", "Product Manager", "Senior Product Manager", "Program Manager", "Product Owner - Growth"];
    const s = suggestTitles(configured, matched);
    expect(s[0]).toMatchObject({ count: 4 });
    expect(s[0].title).toMatch(/Product Owner/);
    expect(s.some((x) => /Product Manager/.test(x.title))).toBe(false);
  });
  it("needs a minimum number of matches, and ignores junk", () => {
    expect(suggestTitles(configured, ["Program Manager"])).toEqual([]);
    expect(suggestTitles(configured, ["", "x", "A".repeat(200)])).toEqual([]);
  });
  it("is limited to the most common few", () => {
    const many = Array.from({ length: 8 }, (_, i) => [`Role${i} Lead`, `Role${i} Lead`]).flat();
    expect(suggestTitles(configured, many, 2, 3)).toHaveLength(3);
  });
});

describe("silent failures", () => {
  const h = (xs: number[]) => xs.map((fetched) => ({ fetched }));
  const history = new Map([["a", h([20, 18, 25])], ["b", h([5, 9, 7])], ["c", h([0, 3, 4])]]);
  it("flags a source whose usual searches all came back empty", () => {
    expect(silentDrop([{ key: "a", fetched: 0 }, { key: "b", fetched: 0 }], history)).toBe(true);
  });
  it("does not flag a normal quiet run, a single empty search, or searches with no history", () => {
    expect(silentDrop([{ key: "a", fetched: 12 }, { key: "b", fetched: 3 }], history)).toBe(false);
    expect(silentDrop([{ key: "a", fetched: 0 }, { key: "b", fetched: 4 }, { key: "c", fetched: 2 }], history)).toBe(false);
    expect(silentDrop([{ key: "x", fetched: 0 }, { key: "y", fetched: 0 }], history)).toBe(false);
    expect(silentDrop([{ key: "a", fetched: 0 }], history)).toBe(false);
    expect(silentDrop([{ key: "c", fetched: 0 }, { key: "a", fetched: 0 }], history)).toBe(false); // c was empty recently, so empty is not new
  });
});
