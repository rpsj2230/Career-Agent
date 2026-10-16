import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtDuration, isValidZone, localDate, localDayBounds } from "@/lib/time";

describe("time zone formatting", () => {
  it("shows the same instant in the viewer's zone, not the server's", () => {
    const iso = "2026-10-16T20:30:00Z";
    expect(fmtDateTime(iso, "Asia/Kolkata")).toBe("17 Oct 2026, 2:00 AM");
    expect(fmtDateTime(iso, "Asia/Singapore")).toBe("17 Oct 2026, 4:30 AM");
    expect(fmtDateTime(iso, "UTC")).toBe("16 Oct 2026, 8:30 PM");
    expect(fmtDate(iso, "America/New_York")).toBe("16 Oct 2026");
  });
  it("returns the placeholder for missing or invalid values", () => {
    expect(fmtDateTime(null)).toBe("-");
    expect(fmtDateTime("not a date", "UTC", "never")).toBe("never");
  });
  it("validates zone names", () => {
    expect(isValidZone("Asia/Kolkata")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone(undefined)).toBe(false);
  });
});

describe("localDayBounds", () => {
  it("converts a local calendar day to UTC bounds", () => {
    const b = localDayBounds("2026-10-16", "Asia/Kolkata")!;
    expect(b.from).toBe("2026-10-15T18:30:00.000Z");
    expect(b.to).toBe("2026-10-16T18:29:59.999Z");
  });
  it("handles days that are 23 and 25 hours long (daylight saving)", () => {
    const spring = localDayBounds("2026-03-08", "America/New_York")!; // clocks go forward
    const autumn = localDayBounds("2026-11-01", "America/New_York")!; // clocks go back
    const hours = (b: { from: string; to: string }) => Math.round((new Date(b.to).getTime() - new Date(b.from).getTime()) / 3600_000);
    expect(hours(spring)).toBe(23);
    expect(hours(autumn)).toBe(25);
  });
  it("rejects malformed dates", () => {
    expect(localDayBounds("16/10/2026")).toBeNull();
    expect(localDayBounds("2026-13-45")).toBeNull();
  });
});

describe("localDate / fmtDuration", () => {
  it("computes today and earlier days in the zone", () => {
    const now = new Date("2026-10-16T20:30:00Z");
    expect(localDate(0, "Asia/Kolkata", now)).toBe("2026-10-17"); // already tomorrow in India
    expect(localDate(0, "UTC", now)).toBe("2026-10-16");
    expect(localDate(7, "UTC", now)).toBe("2026-10-09");
  });
  it("formats durations", () => {
    expect(fmtDuration("2026-10-16T10:00:00Z", "2026-10-16T10:00:42Z")).toBe("42s");
    expect(fmtDuration("2026-10-16T10:00:00Z", "2026-10-16T10:05:07Z")).toBe("5m 07s");
    expect(fmtDuration("2026-10-16T10:00:00Z", "2026-10-16T12:05:00Z")).toBe("2h 05m");
    expect(fmtDuration("2026-10-16T10:00:00Z", null)).toBeNull();
  });
});
