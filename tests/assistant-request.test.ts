import { describe, expect, it } from "vitest";
import { panelText, requestPending, watcherOnline } from "@/lib/apply/assistant-request";

const now = new Date("2026-03-10T12:00:00Z");
const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("assistant request", () => {
  it("is pending until handled at or after it", () => {
    expect(requestPending(null)).toBe(false);
    expect(requestPending({ at: ago(1) })).toBe(true);
    expect(requestPending({ at: ago(5), handled_at: ago(1) })).toBe(false);
    expect(requestPending({ at: ago(1), handled_at: ago(5) })).toBe(true);
  });
  it("is online only if it reported within three minutes", () => {
    expect(watcherOnline({ at: ago(1) }, now)).toBe(true);
    expect(watcherOnline({ at: ago(10) }, now)).toBe(false);
    expect(watcherOnline(null, now)).toBe(false);
  });
  it("explains each state", () => {
    expect(panelText({ hb: { at: ago(1) }, req: { at: ago(0.2) }, waiting: 2, now }).text).toMatch(/within about 30 seconds/);
    expect(panelText({ hb: { at: ago(1) }, req: null, waiting: 1, now }).text).toMatch(/running on your computer; 1 application is waiting/);
    expect(panelText({ hb: { at: ago(60) }, req: { at: ago(1) }, waiting: 1, now }).text).toMatch(/not running on your computer/);
    const idle = panelText({ hb: null, req: { at: ago(9), handled_at: ago(8), done: 3 }, waiting: 0, now });
    expect(idle.online).toBe(false);
    expect(idle.text).toMatch(/not running.*Last run: 3 submitted/);
  });
});
