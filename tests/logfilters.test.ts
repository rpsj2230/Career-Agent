import { describe, expect, it } from "vitest";
import { activeFilterLabels, logHref, parseLogFilters, presetRange } from "@/lib/log-filters";
import { summarizeScans } from "@/lib/scan-summary";

const RUN = "d4468231-5c0d-47eb-b66c-1c76b2796b10";

describe("parseLogFilters", () => {
  it("defaults to no filters on page 1", () => expect(parseLogFilters({})).toEqual({ page: 1, size: 25 }));
  it("accepts every valid filter", () => {
    const f = parseLogFilters({ from: "2026-10-01", to: "2026-10-16", level: "error", category: "job", kind: "job.rejected", portal: "LinkedIn", country: "SG", company: "Acme", status: "rejected", run: RUN.toUpperCase(), q: "below threshold", page: "3" });
    expect(f).toMatchObject({ from: "2026-10-01", to: "2026-10-16", level: "error", category: "job", kind: "job.rejected", portal: "linkedin", country: "sg", company: "Acme", status: "rejected", run: RUN, q: "below threshold", page: 3 });
  });
  it("drops malformed or hostile values", () => {
    const f = parseLogFilters({ from: "yesterday", to: "2026-13-99x", level: "debug", category: "x'; drop", kind: "nope.nope", portal: "a b", country: "usa", status: "Bad Status!", run: "not-a-uuid", app: "1", job: "2", page: "-4" });
    expect(f).toEqual({ page: 1, size: 25 });
  });
  it("neutralises filter-breaking characters in free text", () => {
    expect(parseLogFilters({ company: "Acme),id.neq.0,(x" }).company).toBe("Acme id.neq.0 x");
    expect(parseLogFilters({ page: "99999" }).page).toBe(1);
    expect(parseLogFilters({ page: "2.7" }).page).toBe(2);
  });
});

describe("logHref / activeFilterLabels", () => {
  it("builds a link that round-trips through the parser and omits defaults", () => {
    const f = parseLogFilters({ level: "error", portal: "indeed", page: "2" });
    expect(logHref(f)).toBe("/logs?level=error&portal=indeed&page=2");
    expect(parseLogFilters(Object.fromEntries(new URL("http://x" + logHref(f)).searchParams))).toEqual(f);
    expect(logHref({ page: 1 })).toBe("/logs");
    expect(logHref({ run: RUN }, "/logs")).toBe(`/logs?run=${RUN}`);
  });
  it("labels the active filters so each can be removed", () => {
    expect(activeFilterLabels(parseLogFilters({ level: "warn", country: "au", run: RUN })).map((c) => c.label)).toEqual(["level: warn", "country: AU", "run d4468231"]);
  });
});

describe("presetRange", () => {
  it("resolves presets in the display time zone", () => {
    const now = new Date("2026-10-16T20:30:00Z"); // already the 17th in India
    expect(presetRange("today", "Asia/Kolkata", now)).toEqual({ from: "2026-10-17", to: "2026-10-17" });
    expect(presetRange("7d", "UTC", now)).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    expect(presetRange("30d", "UTC", now)).toEqual({ from: "2026-09-17", to: "2026-10-16" });
  });
});

describe("summarizeScans", () => {
  const scan = (o: Partial<Parameters<typeof summarizeScans>[0][number]>) => ({ integration: "adzuna", status: "ok", fetched: 10, inserted: 4, duplicates: 6, stale: 0, invalid: 0, started_at: "2026-10-16T01:00:00Z", error: null, ...o });
  it("totals scans, failures and jobs per source and keeps the most recent time and an error", () => {
    const t = summarizeScans([
      scan({}), scan({ started_at: "2026-10-16T05:00:00Z", fetched: 5, inserted: 1, duplicates: 4 }),
      scan({ integration: "jsearch", status: "error", fetched: 0, inserted: 0, duplicates: 0, error: "429 quota" }),
      scan({ integration: "remotive", inserted: 9 }),
    ]);
    expect(t.map((x) => x.integration)).toEqual(["remotive", "adzuna", "jsearch"]); // by new jobs found
    expect(t.find((x) => x.integration === "adzuna")).toMatchObject({ scans: 2, failed: 0, fetched: 15, inserted: 5, duplicates: 10, lastScanAt: "2026-10-16T05:00:00Z" });
    expect(t.find((x) => x.integration === "jsearch")).toMatchObject({ scans: 1, failed: 1, lastError: "429 quota" });
  });
  it("is empty for no scans", () => expect(summarizeScans([])).toEqual([]));
});

describe("log page size", () => {
  it("accepts 10, 25, 50 or 100 and ignores anything else", () => {
    for (const n of [10, 25, 50, 100]) expect(parseLogFilters({ size: String(n) }).size).toBe(n);
    expect(parseLogFilters({ size: "7" }).size).toBe(25);
    expect(parseLogFilters({ size: "abc" }).size).toBe(25);
  });
  it("keeps a chosen size in links but drops the default", () => {
    expect(logHref({ page: 2, size: 50 })).toBe("/logs?page=2&size=50");
    expect(logHref({ page: 2, size: 25 })).toBe("/logs?page=2");
  });
});
