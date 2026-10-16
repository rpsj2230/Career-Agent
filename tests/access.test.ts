import { describe, expect, it } from "vitest";
import { cronBearerValid, decideAccess, isPublic, parseAllowlist, safeNext } from "@/lib/access";
import { checkSignup } from "@/lib/signup";

describe("parseAllowlist", () => {
  it("lowercases, trims and drops blanks", () => expect(parseAllowlist(" A@x.com, ,B@Y.com ")).toEqual(["a@x.com", "b@y.com"]));
  it("is empty when unset", () => expect(parseAllowlist(undefined)).toEqual([]));
});

describe("decideAccess", () => {
  const list = ["me@x.com"];
  it("sends anonymous visitors to login (pages) or 401 (APIs)", () => {
    expect(decideAccess({ user: null, allowlist: list, isApi: false }).kind).toBe("login");
    expect(decideAccess({ user: null, allowlist: list, isApi: true }).kind).toBe("unauthorized");
    expect(decideAccess({ user: null, allowlist: [], isApi: false }).kind).toBe("login");
  });
  it("allows an allowlisted email regardless of case, and refuses any other signed-in account", () => {
    expect(decideAccess({ user: { email: "ME@X.com" }, allowlist: list, isApi: false }).kind).toBe("allow");
    expect(decideAccess({ user: { email: "other@x.com" }, allowlist: list, isApi: true }).kind).toBe("forbidden");
    expect(decideAccess({ user: { email: null }, allowlist: list, isApi: false }).kind).toBe("forbidden");
  });
  it("fails closed: with no owner yet, even a signed-in user is refused", () => {
    expect(decideAccess({ user: { email: "me@x.com" }, allowlist: [], isApi: false }).kind).toBe("forbidden");
  });
});

describe("public paths, cron bearer and redirects", () => {
  it("exposes only the sign-in, sign-up and sign-out endpoints", () => {
    for (const p of ["/login", "/api/auth/signup", "/api/auth/login", "/api/auth/logout"]) expect(isPublic(p), p).toBe(true);
    for (const p of ["/", "/jobs", "/api/models", "/login/x", "/api/auth/signup/x"]) expect(isPublic(p), p).toBe(false);
  });
  it("accepts the cron token only on /api/cron/*", () => {
    expect(cronBearerValid("/api/cron/score", "Bearer s3cret", "s3cret")).toBe(true);
    expect(cronBearerValid("/api/models", "Bearer s3cret", "s3cret")).toBe(false);
    expect(cronBearerValid("/api/cron/score", "Bearer nope", "s3cret")).toBe(false);
    expect(cronBearerValid("/api/cron/score", "Bearer s3cret", undefined)).toBe(false);
    expect(cronBearerValid("/api/cron/score", null, "s3cret")).toBe(false);
  });
  it("only follows same-site relative paths after login", () => {
    expect(safeNext("/jobs?x=1")).toBe("/jobs?x=1");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined]) expect(safeNext(bad as never), String(bad)).toBe("/");
  });
});

describe("checkSignup", () => {
  const env = { CRON_SECRET: "a-long-cron-secret-1234" };
  const good = { email: "Me@X.com", password: "correct horse battery", code: "a-long-cron-secret-1234" };
  it("accepts the right invite code and lowercases the email", () => {
    expect(checkSignup(good, env)).toEqual({ ok: true, email: "me@x.com", password: "correct horse battery" });
  });
  it("prefers INVITE_CODE over CRON_SECRET when set", () => {
    const both = { ...env, INVITE_CODE: "another-long-invite-code" };
    expect(checkSignup(good, both)).toMatchObject({ ok: false, status: 403 });
    expect(checkSignup({ ...good, code: "another-long-invite-code" }, both).ok).toBe(true);
  });
  it("refuses a wrong or missing code (blocks pre-registration takeover) and weak passwords", () => {
    expect(checkSignup({ ...good, code: "wrong" }, env)).toMatchObject({ ok: false, status: 403 });
    expect(checkSignup({ ...good, code: "" }, env).ok).toBe(false);
    expect(checkSignup({ ...good, password: "short" }, env)).toMatchObject({ ok: false, status: 400 });
  });
  it("is switched off when no sufficiently long secret exists", () => {
    expect(checkSignup(good, {})).toMatchObject({ ok: false, status: 503 });
    expect(checkSignup(good, { CRON_SECRET: "short" })).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects malformed input", () => expect(checkSignup({ email: "nope" }, env)).toMatchObject({ ok: false, status: 400 }));
});
