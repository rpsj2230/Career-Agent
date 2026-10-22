import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from "sonner";
import { call, callDetailed, REQUEST_TIMEOUT_MS } from "@/components/app/api";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); });

describe("callDetailed", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { ok: true })));
    expect(await callDetailed("/x", "PUT", { a: 1 })).toEqual({ ok: true, data: { ok: true } });
  });
  it("returns the server's own error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: "per_run: too big" })));
    expect(await callDetailed("/x", "PUT", {})).toEqual({ ok: false, error: "per_run: too big" });
  });
  it("names the status when the body has no error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway</html>", { status: 504 })));
    expect(await callDetailed("/x", "PUT", {})).toEqual({ ok: false, error: "Request failed (504)" });
  });
  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Failed to fetch"); }));
    expect(await callDetailed("/x", "PUT", {})).toEqual({ ok: false, error: "Failed to fetch" });
  });
  it("stops waiting and says so when the server never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))));
    const p = callDetailed("/x", "PUT", {});
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/did not answer within 30 seconds/);
  });
});

describe("call", () => {
  it("toasts success and the error, and returns null on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { ok: true })));
    expect(await call("/x", "PUT", {}, "Saved")).toEqual({ ok: true });
    expect(toast.success).toHaveBeenCalledWith("Saved");
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: "nope" })));
    expect(await call("/x", "PUT", {}, "Saved")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("nope");
  });
});
