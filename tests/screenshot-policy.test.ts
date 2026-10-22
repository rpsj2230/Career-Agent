import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROOF_DAYS, planScreenshots, shotPaths } from "../src/lib/apply/screenshot-policy";
import { dropShots } from "../worker/shots";

const id = "11111111-1111-1111-1111-111111111111";
const now = new Date("2026-10-23T00:00:00Z");
const p = shotPaths(id);

describe("which pictures an application keeps", () => {
  it("sent: the working pictures go at once, the confirmation stays for the proof period, then everything goes", () => {
    const fresh = { id, status: "submitted", submitted_at: "2026-10-22T00:00:00Z" };
    expect(planScreenshots(fresh, "applied", now, DEFAULT_PROOF_DAYS, null)).toEqual({ stage: "working", paths: [p.live, p.last] });
    expect(planScreenshots(fresh, "applied", now, DEFAULT_PROOF_DAYS, "working")).toBeNull(); // already done, not looked at again
    const old = { id, status: "submitted", submitted_at: "2026-10-01T00:00:00Z" };
    expect(planScreenshots(old, "applied", now, DEFAULT_PROOF_DAYS, "working")).toEqual({ stage: "all", paths: [p.live, p.last, p.proof] });
    expect(planScreenshots(old, "applied", now, DEFAULT_PROOF_DAYS, "all")).toBeNull();
  });
  it("0 days means no proof picture is kept", () => {
    expect(planScreenshots({ id, status: "submitted", submitted_at: "2026-10-22T23:00:00Z" }, "applied", now, 0, null)?.stage).toBe("all");
  });
  it("a closed or skipped job loses every picture at once, whatever its application says", () => {
    for (const status of ["needs_input", "failed", "assisted_pending", "submitted"]) {
      expect(planScreenshots({ id, status, submitted_at: null }, "skipped", now, DEFAULT_PROOF_DAYS, null), status).toEqual({ stage: "all", paths: [p.live, p.last, p.proof] });
    }
  });
  it("an application that is still open keeps the picture of where it stopped", () => {
    for (const status of ["needs_input", "failed", "prepared", "approved", "assisted_pending", "submitting"]) expect(planScreenshots({ id, status, submitted_at: null }, "queued", now, DEFAULT_PROOF_DAYS, null), status).toBeNull();
  });
});

describe("deleting a picture from a worker", () => {
  it("removes the named pictures of that application", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const sb = { storage: { from: vi.fn().mockReturnValue({ remove }) } };
    await dropShots(sb as never, id, ["live", "last"]);
    expect(sb.storage.from).toHaveBeenCalledWith("documents");
    expect(remove).toHaveBeenCalledWith([p.live, p.last]);
  });
  it("never throws, even when storage is unreachable", async () => {
    const sb = { storage: { from: () => { throw new Error("offline"); } } };
    await expect(dropShots(sb as never, id, ["live"])).resolves.toBeUndefined();
  });
});
