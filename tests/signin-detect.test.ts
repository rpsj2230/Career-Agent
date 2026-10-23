import { describe, expect, it } from "vitest";
import { assistChecks, type CheckInput } from "../worker/assist-check-lib";
import { boardDenied, linkedinSignedIn } from "../worker/match";
import { signinStatus, workersOverview, type WorkersInput } from "@/lib/workers-overview";

describe("is the assistant's browser signed in to LinkedIn?", () => {
  const now = 1_800_000_000;
  it("needs the li_at cookie on linkedin.com that has not expired", () => {
    expect(linkedinSignedIn([{ name: "li_at", domain: ".www.linkedin.com", expires: now + 1000 }], now)).toBe(true);
    expect(linkedinSignedIn([{ name: "li_at", domain: ".linkedin.com", expires: -1 }], now)).toBe(true); // a session cookie
    expect(linkedinSignedIn([{ name: "li_at", domain: ".linkedin.com", expires: now - 10 }], now)).toBe(false);
    expect(linkedinSignedIn([{ name: "JSESSIONID", domain: ".linkedin.com" }, { name: "bcookie", domain: ".linkedin.com" }], now)).toBe(false); // what a signed-out visitor holds
    expect(linkedinSignedIn([{ name: "li_at", domain: ".notlinkedin.com", expires: now + 1000 }], now)).toBe(false);
    expect(linkedinSignedIn([], now)).toBe(false);
  });
});

describe("a job board that refuses the browser", () => {
  it("recognises the Access Denied and 'request could not be satisfied' pages from the assistant log", () => {
    expect(boardDenied("Access Denied", "Access Denied You don't have permission to access ...")).toBe(true);
    expect(boardDenied("ERROR: The request could not be satisfied", "403 ERROR The request could not be satisfied. Request blocked.")).toBe(true);
    expect(boardDenied("", "Access Denied\nYou don't have permission to access this server.")).toBe(true);
  });
  it("does not mistake a real listing for one", () => {
    expect(boardDenied("Business Analyst - adzuna.com.au", "Business Analyst Ambition Group Sydney ".repeat(80))).toBe(false);
    expect(boardDenied("Senior PM", "We explain how access is denied to unauthorised users in our policy. ".repeat(40))).toBe(false);
  });
});

describe("assist:check and the Workers card say the sign-in is missing", () => {
  const base: CheckInput = { hasUrl: true, hasKey: true, dbOk: true, heartbeatAgeMs: 1000, watching: true, autoApplyOn: true, localAutoOn: true, waiting: 5, chromiumFound: true, profileExists: true };
  it("only judges a watcher that reported its sign-ins", () => {
    expect(assistChecks(base).some((l) => /LinkedIn/.test(l.label))).toBe(false);
    const missing = assistChecks({ ...base, signedIn: [] }).find((l) => /LinkedIn/.test(l.label))!;
    expect(missing.ok).toBe(false);
    expect(missing.fix).toMatch(/npm run assist:login/);
    expect(assistChecks({ ...base, signedIn: ["linkedin"] }).find((l) => /LinkedIn/.test(l.label))!.ok).toBe(true);
  });
  it("profile folder line no longer claims you are signed in", () => {
    expect(assistChecks(base).find((l) => /profile exists/.test(l.label))!.label).toMatch(/does not prove/);
  });
  it("Workers card shows it for your computer", () => {
    expect(signinStatus({ at: "2026-10-22T10:00:00Z", signedIn: [] })).toMatchObject({ ok: false });
    expect(signinStatus({ at: "2026-10-22T10:00:00Z", signedIn: ["linkedin"] })).toMatchObject({ ok: true });
    expect(signinStatus({ at: "2026-10-22T10:00:00Z" })).toBeNull();
    const i = { now: new Date("2026-10-22T10:01:00Z"), computer: { at: "2026-10-22T10:00:30Z", signedIn: [] }, oracle: null, github: null, cloud: { enabled: true, fallback_minutes: 90 }, started24h: {}, declined24h: {} } as WorkersInput;
    expect(workersOverview(i).find((r) => r.id === "computer")!.signin).toMatchObject({ ok: false });
  });
});

describe("assist:check says whether the local AI model will answer", () => {
  const base: CheckInput = { hasUrl: true, hasKey: true, dbOk: true, heartbeatAgeMs: 1000, watching: true, autoApplyOn: true, localAutoOn: true, waiting: 0, chromiumFound: true, profileExists: true };
  const line = (localModel: CheckInput["localModel"]) => assistChecks({ ...base, localModel }).find((l) => /local AI model/i.test(l.label))!;
  it("says what to run when there is none, when Ollama is not running, and when the model is not downloaded", () => {
    expect(line({ name: null, ollamaReachable: false, downloaded: false })).toMatchObject({ ok: false, fix: expect.stringContaining("bash scripts/setup-local-model.sh") });
    expect(line({ name: "qwen2.5:3b-instruct", ollamaReachable: false, downloaded: false })).toMatchObject({ ok: false, label: expect.stringContaining("Ollama is not running") });
    expect(line({ name: "qwen2.5:3b-instruct", ollamaReachable: true, downloaded: false })).toMatchObject({ ok: false, fix: "Run: ollama pull qwen2.5:3b-instruct" });
  });
  it("is satisfied only when the model is set, Ollama answers and the model is downloaded; older callers are not asked", () => {
    expect(line({ name: "qwen2.5:3b-instruct", ollamaReachable: true, downloaded: true }).ok).toBe(true);
    expect(assistChecks(base).some((l) => /local AI model/i.test(l.label))).toBe(false);
  });
});
