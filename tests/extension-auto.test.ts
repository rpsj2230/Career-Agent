import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAuto } from "@/lib/extension/auto";

describe("when the extension may press Submit by itself", () => {
  const base = { enabled: true, paused: false, dailyTotal: 15, submittedToday: 3 };
  it("only with Auto-Apply on, not paused, and the daily limit not used up", () => {
    expect(decideAuto(base)).toEqual({ allowed: true, remainingToday: 12, why: null });
    expect(decideAuto({ ...base, enabled: false })).toMatchObject({ allowed: false, why: expect.stringContaining("Auto-Apply is switched off") });
    expect(decideAuto({ ...base, paused: true })).toMatchObject({ allowed: false, why: expect.stringContaining("paused") });
    expect(decideAuto({ ...base, submittedToday: 15 })).toMatchObject({ allowed: false, remainingToday: 0, why: expect.stringContaining("limit of 15") });
    expect(decideAuto({ ...base, submittedToday: 40 }).remainingToday).toBe(0);
  });
});

const calls: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/extension/auth", () => ({ withExtensionToken: async (req: Request, fn: () => Promise<unknown>) => (req.headers.get("authorization") === "Bearer ok" ? fn() : null) }));
vi.mock("@/lib/extension/claim", () => ({
  claimApplication: async (id: string) => { calls.push(`claim ${id}`); return id.startsWith("00000000-0000-4000-8000-00000000000f") ? { ok: false, status: 409, error: "limit", global: true } : { ok: true }; },
  releaseApplication: async (id: string, note: string) => { calls.push(`release ${id} ${note}`); return { ok: true }; },
}));
vi.mock("@/lib/apply/mark-submitted", () => ({ markSubmitted: async (id: string, via: string, extra: { confirmation?: string | null }) => { calls.push(`submitted ${id} ${via} ${extra.confirmation ?? "-"}`); return { ok: true }; } }));

import { POST } from "@/app/api/extension/mark/route";
const ID = "11111111-2222-4333-8444-555555555555";
const post = (body: unknown, auth = "Bearer ok") => POST(new Request("http://x/api/extension/mark", { method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) }));

describe("what the extension may report", () => {
  beforeEach(() => { calls.length = 0; });
  it("claim, release (with a reason) and submitted (with the employer's confirmation)", async () => {
    expect((await post({ applicationId: ID, action: "claim" })).status).toBe(200);
    expect((await post({ applicationId: ID, action: "release", note: "a captcha needs you" })).status).toBe(200);
    expect((await post({ applicationId: ID, action: "submitted", confirmation: "Thank you for applying", finalUrl: "https://x.com/done" })).status).toBe(200);
    expect(calls).toEqual([`claim ${ID}`, `release ${ID} a captcha needs you`, `submitted ${ID} extension Thank you for applying`]);
  });
  it("an older extension that sends no action is read as 'I submitted it'", async () => {
    expect((await post({ applicationId: ID })).status).toBe(200);
    expect(calls).toEqual([`submitted ${ID} extension -`]);
  });
  it("says whether a refusal applies to every application", async () => {
    const r = await post({ applicationId: "00000000-0000-4000-8000-00000000000f", action: "claim" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "limit", global: true });
  });
  it("rejects a release without a reason, a malformed id, an unknown action and a missing or wrong code", async () => {
    expect((await post({ applicationId: ID, action: "release" })).status).toBe(400);
    expect((await post({ applicationId: "nope", action: "claim" })).status).toBe(400);
    expect((await post({ applicationId: ID, action: "approve" })).status).toBe(400);
    expect((await post({ applicationId: ID, action: "claim" }, "Bearer wrong")).status).toBe(401);
    expect(calls).toEqual([]);
  });
});
