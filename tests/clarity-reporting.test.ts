import { describe, expect, it, vi } from "vitest";
import type { Check } from "@/lib/automation-checks";
import { evaluateDelivery, healthText, runsText } from "@/lib/delivery-text";
import { sendEmail, smtpFromMailbox } from "@/lib/email";
import { localModelNeeded } from "@/lib/local-model";
import { describeSource, lastBatch, type SourceRow } from "@/lib/search-summary";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({}), must: (r: { data: unknown }) => r.data }));
import { shouldRetry } from "@/lib/schedule-store";

describe("daily delivery timing", () => {
  const base = { enabled: true, hour: 8, localHour: 9, today: "2026-10-18", lastDate: null };
  it("sends once, after the chosen hour", () => {
    expect(evaluateDelivery(base)).toBe("send");
    expect(evaluateDelivery({ ...base, localHour: 7 })).toBe("too early");
    expect(evaluateDelivery({ ...base, lastDate: "2026-10-18" })).toBe("already sent today");
    expect(evaluateDelivery({ ...base, lastDate: "2026-10-17" })).toBe("send");
    expect(evaluateDelivery({ ...base, enabled: false })).toBe("off");
  });
});

describe("the morning message text", () => {
  const checks: Check[] = [
    { id: "tick", label: "Hourly GitHub check", status: "ok", detail: "Last reached the app 30 min ago." },
    { id: "models", label: "AI models", status: "fail", detail: "No model has a usable key.", fix: "Add a key on the Models page." },
    { id: "dispatch", label: "Background runs from the site", status: "warn", detail: "Not connected." },
  ];
  it("says what is healthy and, for everything else, what is wrong and how to fix it", () => {
    const t = healthText(checks);
    expect(t).toMatch(/2 thing\(s\) need attention/);
    expect(t).toMatch(/PROBLEM: AI models: No model has a usable key\.\n\s+How to fix: Add a key/);
    expect(t).toMatch(/CHECK: Background runs from the site/);
    expect(t).toMatch(/Healthy: Hourly GitHub check/);
    expect(healthText(checks.filter((c) => c.status === "ok"))).toMatch(/Everything is healthy/);
  });
  it("lists each run with its result, or says none happened", () => {
    expect(runsText([])).toMatch(/No automatic run/);
    const t = runsText([{ kind: "pipeline", status: "partial", started_at: "2026-10-17T22:00:00Z", finished_at: null, stats: { inserted: 12, scored: 10, matched: 4, prepared: 3 }, error: "Scoring failed: boom", trigger: "schedule" }], "UTC");
    expect(t).toMatch(/22:00 Scheduled run \(schedule\): partial — 12 found, 10 scored, 4 matched, 3 prepared — Scoring failed/);
  });
});

describe("email", () => {
  it("sends through the connected Gmail mailbox's mail server", () => {
    expect(smtpFromMailbox({ host: "imap.gmail.com", user: "me@gmail.com", password: "pw" }, {})).toEqual({ host: "smtp.gmail.com", port: 465, user: "me@gmail.com", password: "pw" });
    expect(smtpFromMailbox(undefined, {})).toBeNull();
    expect(smtpFromMailbox(undefined, { SMTP_HOST: "mail.x.com", SMTP_USER: "u", SMTP_PASSWORD: "p", SMTP_PORT: "587" })).toMatchObject({ host: "mail.x.com", port: 587 });
  });
  it("reports why it could not send, never throws", async () => {
    const cfg = { host: "smtp.gmail.com", port: 465, user: "me@gmail.com", password: "pw" };
    expect(await sendEmail(null, { to: "a@b.co", subject: "s", text: "t" })).toMatch(/not set up/);
    expect(await sendEmail(cfg, { to: "nope", subject: "s", text: "t" })).toMatch(/not an email address/);
    expect(await sendEmail(cfg, { to: "a@b.co", subject: "s", text: "t" }, () => ({ sendMail: async () => { throw new Error("535 Username and Password not accepted"); } }))).toMatch(/app password/);
    const sent: Record<string, unknown>[] = [];
    expect(await sendEmail(cfg, { to: "a@b.co", subject: "Hi", text: "Body" }, () => ({ sendMail: async (o) => { sent.push(o); } }))).toBeNull();
    expect(sent[0]).toMatchObject({ to: "a@b.co", subject: "Hi", text: "Body" });
  });
});

describe("retrying a schedule that failed", () => {
  const run = (status: string) => ({ status });
  it("retries failures, and stops after three in a row", () => {
    expect(shouldRetry("failed", "boom", [run("failed")])).toBe(true);
    expect(shouldRetry("failed", "boom", [run("failed"), run("failed"), run("failed")])).toBe(false);
    expect(shouldRetry("succeeded", null, [run("succeeded")])).toBe(false);
  });
  it("retries a partial run only when the cause looks temporary", () => {
    expect(shouldRetry("partial", "All models failed for task score", [run("partial")])).toBe(true);
    expect(shouldRetry("partial", "429 rate limit", [run("partial")])).toBe(true);
    expect(shouldRetry("partial", "3 of 8 scans failed", [run("partial")])).toBe(false);
  });
});

describe("the local model is started only when it is needed", () => {
  it("follows the chosen mode", () => {
    const m = (mode: "off" | "when_needed" | "always") => ({ mode, model: "qwen2.5:3b-instruct" });
    expect(localModelNeeded(m("off"), 0, { failed: 99, ok: 0 })).toBe(false);
    expect(localModelNeeded(m("always"), 3, { failed: 0, ok: 50 })).toBe(true);
    expect(localModelNeeded(m("when_needed"), 3, { failed: 0, ok: 50 })).toBe(false);
    expect(localModelNeeded(m("when_needed"), 0, { failed: 0, ok: 0 })).toBe(true); // no usable key at all
    expect(localModelNeeded(m("when_needed"), 3, { failed: 12, ok: 3 })).toBe(true); // most calls failing
    expect(localModelNeeded(m("when_needed"), 3, { failed: 6, ok: 40 })).toBe(false); // a few failures among many successes
  });
});

describe("what the last search did, source by source", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const row = (o: Partial<SourceRow>): SourceRow => ({ id: "x", name: "Source", status: "ok", needsConfig: false, lastScanAt: "2026-10-18T10:00:00Z", scans: 3, fetched: 40, inserted: 12, error: null, ...o });
  it("explains every outcome in plain words", () => {
    expect(describeSource(row({}), now)).toMatchObject({ tone: "ok", headline: "12 new jobs 120 min ago".replace("120 min", "2 h") });
    expect(describeSource(row({ status: "needs_setup" }), now)).toMatchObject({ tone: "off", headline: "Not connected" });
    expect(describeSource(row({ status: "needs_setup", needsConfig: true }), now).detail).toMatch(/list of companies/);
    expect(describeSource(row({ status: "disabled" }), now).headline).toBe("Switched off");
    expect(describeSource(row({ lastScanAt: null }), now).headline).toBe("Not searched yet");
    expect(describeSource(row({ inserted: 0, error: "HTTP 401" }), now)).toMatchObject({ tone: "problem", detail: "HTTP 401" });
    expect(describeSource(row({ inserted: 0, fetched: 0 }), now).detail).toMatch(/no postings for your roles and countries/);
    expect(describeSource(row({ inserted: 0, fetched: 30 }), now).detail).toMatch(/already known/);
  });
  it("groups scans into the latest batch", () => {
    const b = lastBatch([
      { started_at: "2026-10-18T10:00:00Z", status: "ok", fetched: 10, inserted: 4, error: null },
      { started_at: "2026-10-18T09:30:00Z", status: "error", fetched: 0, inserted: 0, error: "boom" },
      { started_at: "2026-10-16T09:00:00Z", status: "ok", fetched: 99, inserted: 99, error: null },
    ]);
    expect(b).toMatchObject({ scans: 2, fetched: 10, inserted: 4, error: "boom" });
    expect(lastBatch([]).at).toBeNull();
  });
});
