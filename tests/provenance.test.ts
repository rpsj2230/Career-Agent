import { describe, expect, it } from "vitest";
import { applicationProvenance, type EventRow } from "@/lib/apply/provenance";

const app = (over = {}) => ({ status: "submitted", method: "assisted", submitted_at: "2026-10-19T12:00:00Z", submission: null, ...over });
const ev = (kind: string, at: string, detail: Record<string, unknown> = {}): EventRow => ({ kind, at, detail });

describe("who applied", () => {
  it("is nothing for an application that was not submitted", () => {
    expect(applicationProvenance(app({ status: "needs_input" }), [])).toBeNull();
  });
  it("says so when nothing was recorded, instead of guessing", () => {
    const p = applicationProvenance(app(), [])!;
    expect(p.who).toBe("unknown");
    expect(p.proof.level).toBe("unchecked");
  });
  it("a receipt email is claimed by the portal, not sent by the app", () => {
    const p = applicationProvenance(app(), [ev("marked_submitted", "2026-10-22T10:00:00Z", { why: "The portal's own receipt email says you applied on 2026-10-19" })])!;
    expect(p.who).toBe("receipt");
    expect(p.headline).toMatch(/not by this app/);
    expect(p.proof.level).toBe("claimed");
  });
  it("'I have submitted it' is you, unchecked", () => {
    const p = applicationProvenance(app(), [ev("marked_submitted", "2026-10-19T12:00:00Z")])!;
    expect(p).toMatchObject({ who: "you", proof: { level: "unchecked" } });
  });
  it("hands-free names the worker that started it, with the employer's confirmation as proof", () => {
    const events = [ev("worker_started", "2026-10-19T11:00:00Z", { worker: "github" }), ev("submitted_hands_free", "2026-10-19T11:02:00Z")];
    const p = applicationProvenance(app({ submission: { confirmation: { text: "Thank you for applying" } } }), events)!;
    expect(p.who).toBe("assistant_cloud");
    expect(p.headline).toMatch(/GitHub/);
    expect(p.proof).toMatchObject({ level: "confirmed" });
    expect(applicationProvenance(app(), [ev("submitted_hands_free", "2026-10-19T11:02:00Z")])!.who).toBe("assistant_computer");
  });
  it("assisted means you pressed Submit; the cloud worker and email are named", () => {
    expect(applicationProvenance(app(), [ev("submitted_with_assistant", "2026-10-19T11:00:00Z")])!.who).toBe("you_assistant");
    expect(applicationProvenance(app(), [ev("submitted", "2026-10-19T11:00:00Z", { url: "https://boards.greenhouse.io/x/jobs/1" })])).toMatchObject({ who: "cloud_worker", page: "https://boards.greenhouse.io/x/jobs/1" });
    expect(applicationProvenance(app(), [ev("email_sent", "2026-10-19T11:00:00Z", { to: "hr@x.com" })])).toMatchObject({ who: "email", headline: "Emailed from your mailbox to hr@x.com" });
  });
  it("the most recent submission wins", () => {
    const p = applicationProvenance(app(), [ev("submitted_hands_free", "2026-10-19T11:00:00Z"), ev("marked_submitted", "2026-10-20T09:00:00Z")])!;
    expect(p.who).toBe("you");
  });
});
