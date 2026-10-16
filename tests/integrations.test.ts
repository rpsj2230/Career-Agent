import { describe, expect, it } from "vitest";
import { derivePortalStatus, deriveStatus, explainHttpFailure, integrationById, INTEGRATIONS, PORTALS, type IntegrationState } from "@/lib/integrations/catalog";

const adzuna = integrationById("adzuna")!;
const remotive = integrationById("remotive")!;
const greenhouse = integrationById("greenhouse")!;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const st = (o: Partial<IntegrationState>): IntegrationState => ({ enabled: true, ...o });

describe("catalogue integrity", () => {
  it("has unique ids and every portal route points at a real integration", () => {
    expect(new Set(INTEGRATIONS.map((i) => i.id)).size).toBe(INTEGRATIONS.length);
    for (const p of PORTALS) for (const v of p.via) expect(integrationById(v), `${p.key} via ${v}`).toBeTruthy();
  });
  it("states limitations and setup for every integration and never promises login-based access to closed portals", () => {
    for (const i of INTEGRATIONS) { expect(i.limitations.length, i.id).toBeGreaterThan(0); expect(i.setup.length, i.id).toBeGreaterThan(0); }
    for (const key of ["linkedin", "indeed", "glassdoor", "naukri"]) expect(PORTALS.find((p) => p.key === key)!.apply).toBe("assisted");
    expect(PORTALS.filter((p) => p.apply === "automated").map((p) => p.key)).toEqual(["greenhouse", "lever"]);
  });
});

describe("deriveStatus", () => {
  it("is planned for unavailable integrations and disabled when switched off", () => {
    expect(deriveStatus({ ...integrationById("mailbox")!, available: false }, undefined, false)).toBe("planned");
    expect(deriveStatus(integrationById("mailbox")!, undefined, false)).toBe("needs_setup");
    expect(deriveStatus(adzuna, st({ enabled: false }), true)).toBe("disabled");
  });
  it("needs setup until credentials (or its list of boards) exist", () => {
    expect(deriveStatus(adzuna, undefined, false)).toBe("needs_setup");
    expect(deriveStatus(greenhouse, undefined, false, false)).toBe("needs_setup");
    expect(deriveStatus(greenhouse, undefined, false, true)).toBe("ready");
  });
  it("is only Working after real evidence, and Ready before it", () => {
    expect(deriveStatus(adzuna, undefined, true)).toBe("ready");
    expect(deriveStatus(adzuna, st({ last_ok_at: ago(5) }), true)).toBe("ok");
    expect(deriveStatus(adzuna, st({ last_test_at: ago(5), last_test_ok: true }), true)).toBe("ok");
  });
  it("shows a problem when the latest evidence is bad, and recovers when a later success follows", () => {
    expect(deriveStatus(adzuna, st({ last_ok_at: ago(60), last_error_at: ago(5), last_error: "429" }), true)).toBe("error");
    expect(deriveStatus(adzuna, st({ last_error_at: ago(60), last_ok_at: ago(5) }), true)).toBe("ok");
    expect(deriveStatus(adzuna, st({ last_test_at: ago(5), last_test_ok: false, last_ok_at: ago(600) }), true)).toBe("error");
  });
  it("treats manual entry as always usable", () => expect(deriveStatus(integrationById("manual")!, undefined, true)).toBe("ok"));
  it("needs no credentials for Remotive", () => expect(deriveStatus(remotive, undefined, false)).toBe("ready"));
});

describe("derivePortalStatus", () => {
  const linkedin = PORTALS.find((p) => p.key === "linkedin")!;
  it("is Working when any route works, and says which", () => {
    const r = derivePortalStatus(linkedin, (id) => (id === "jsearch" ? "ok" : id === "manual" ? "ok" : "planned"), 12);
    expect(r.status).toBe("ok");
    expect(r.note).toContain("JSearch");
  });
  it("is Not connected when the only reachable routes need setup, and reports earlier jobs honestly", () => {
    const all = (id: string) => (id === "manual" ? "planned" : "needs_setup") as never;
    expect(derivePortalStatus({ ...linkedin, via: ["jsearch", "mailbox"] }, all, 0).note).toMatch(/Not connected/);
    expect(derivePortalStatus({ ...linkedin, via: ["jsearch"] }, all, 3).note).toMatch(/3 jobs seen earlier/);
  });
});

describe("explainHttpFailure", () => {
  it("gives actionable messages", () => {
    expect(explainHttpFailure(401, "api.adzuna.com")).toMatch(/rejected the credentials/);
    expect(explainHttpFailure(429, "jsearch.p.rapidapi.com")).toMatch(/quota/);
    expect(explainHttpFailure(404, "boards-api.greenhouse.io")).toMatch(/board token/);
    expect(explainHttpFailure(503, "x")).toMatch(/having problems/);
  });
});
