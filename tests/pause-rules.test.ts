import { describe, expect, it } from "vitest";
import { pauseActive } from "@/lib/pause-rules";

describe("pauseActive", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  it("is off unless paused is true", () => {
    expect(pauseActive(null, now)).toBe(false);
    expect(pauseActive({}, now)).toBe(false);
    expect(pauseActive({ paused: false, until: "2099-01-01T00:00:00Z" }, now)).toBe(false);
  });
  it("lasts until switched off when there is no end time", () => {
    expect(pauseActive({ paused: true }, now)).toBe(true);
    expect(pauseActive({ paused: true, until: "" }, now)).toBe(true);
  });
  it("ends by itself at the end time", () => {
    expect(pauseActive({ paused: true, until: "2026-10-21T10:10:00Z" }, now)).toBe(true);
    expect(pauseActive({ paused: true, until: "2026-10-21T10:00:00Z" }, now)).toBe(false);
    expect(pauseActive({ paused: true, until: "2026-10-21T09:59:00Z" }, now)).toBe(false);
  });
  it("treats an unreadable end time as a pause with no end, never as running", () => {
    expect(pauseActive({ paused: true, until: "soon" }, now)).toBe(true);
  });
});
