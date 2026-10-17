import { describe, expect, it } from "vitest";
import { pageHref, pageNumbers, pageRange, parsePaging } from "@/lib/pagination";

describe("pagination helpers", () => {
  it("reads page and size, falling back safely", () => {
    expect(parsePaging({})).toEqual({ page: 1, size: 25 });
    expect(parsePaging({ page: "3", size: "50" })).toEqual({ page: 3, size: 50 });
    expect(parsePaging({ page: "-4", size: "7" })).toEqual({ page: 1, size: 25 });
    expect(parsePaging({ page: "abc" })).toEqual({ page: 1, size: 25 });
    expect(parsePaging({ page: ["2", "9"] })).toEqual({ page: 2, size: 25 });
  });
  it("clamps the page and gives the row range", () => {
    expect(pageRange(101, 1, 25)).toMatchObject({ pages: 5, from: 0, to: 24, shownFrom: 1, shownTo: 25 });
    expect(pageRange(101, 5, 25)).toMatchObject({ page: 5, from: 100, shownFrom: 101, shownTo: 101 });
    expect(pageRange(101, 99, 25).page).toBe(5);
    expect(pageRange(0, 1, 25)).toMatchObject({ pages: 1, shownFrom: 0, shownTo: 0 });
  });
  it("shows first, last and a window with gaps", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, null, 20]);
  });
  it("keeps every filter in the link and drops default values", () => {
    expect(pageHref("/jobs", { view: "queue", country: "sg", page: "4" }, 2, 25)).toBe("/jobs?view=queue&country=sg&page=2");
    expect(pageHref("/jobs", { view: "queue" }, 1, 25)).toBe("/jobs?view=queue");
    expect(pageHref("/jobs", { view: "queue", size: "50" }, 3, 50)).toBe("/jobs?view=queue&size=50&page=3");
    expect(pageHref("/jobs", {}, 1)).toBe("/jobs");
  });
});
