import { describe, expect, it } from "vitest";
import { cronBearerValid, decideAccess, isPublic, parseAllowlist, safeNext } from "@/lib/access";
import { checkSignup } from "@/lib/signup";

describe("parseAllowlist", () => {
  it("lowercases, trims and drops blanks", () => expect(parseAllowlist(" A@x.com, ,B@Y.com ")).toEqual(["a@x.com", "b@y.com"]));
  it("is empty when unset", () => expect(parseAllowlist(undefined)).toEqual([]));
});

describe("decideAccess", () => {
  const list = ["me@x.com"];
  it("fails closed without an allowlist, even for a signed-in user", () => {
    expect(decideAccess({ user: { email: "me@x.com" }, allowlist: [], isApi: false }).kind).toBe("misconfigured");
  });
  it("sends anonymous visitors to login (pages) or 401 (APIs)", () => {
    expect(decideAccess({ user: null, allowlist: list, isApi: false }).kind).toBe("login");
    expect(decideAccess({ user: null, allowlist: list, isApi: true }).kind).toBe("unauthorized");
  });
  it("allows an allowlisted email regardless of case, and refuses any other signed-in account", () => {
    expect(decideAccess({ user: { email: "ME@X.com" }, allowlist: list, isApi: false }).kind).toBe("allow");
    expect(decideAccess({ user: { email: "other@x.com" }, allowlist: list, isApi: true }).kind).toBe("forbidden");
    expect(decideAccess({ user: { email: null }, allowlist: list, isApi: false }).kind).toBe("forbidden");
  });
});

describe("public paths, cron bearer and redirects", () => {
  it("exposes only login and signup", () => {
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/api/auth/signup")).toBe(true);
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
  const env = { ALLOWED_EMAILS: "me@x.com", INVITE_CODE: "a-long-invite-code-123" };
  const good = { email: "Me@X.com", password: "correct horse battery", code: "a-long-invite-code-123" };
  it("creates an account for an allowed email with the right invite code", () => {
    expect(checkSignup(good, env)).toEqual({ ok: true, email: "me@x.com", password: "correct horse battery" });
  });
  it("refuses a wrong code, an email not on the list, and a weak password", () => {
    expect(checkSignup({ ...good, code: "wrong" }, env)).toMatchObject({ ok: false, status: 403 });
    expect(checkSignup({ ...good, email: "stranger@x.com" }, env)).toMatchObject({ ok: false, status: 403 });
    expect(checkSignup({ ...good, password: "short" }, env)).toMatchObject({ ok: false, status: 400 });
  });
  it("refuses a correct allowed email WITHOUT the code (pre-registration takeover)", () => {
    expect(checkSignup({ ...good, code: "" }, env).ok).toBe(false);
  });
  it("is switched off unless both settings exist and the invite code is long enough", () => {
    expect(checkSignup(good, { ALLOWED_EMAILS: "me@x.com" })).toMatchObject({ ok: false, status: 503 });
    expect(checkSignup(good, { ALLOWED_EMAILS: "me@x.com", INVITE_CODE: "short" })).toMatchObject({ ok: false, status: 503 });
    expect(checkSignup(good, { INVITE_CODE: env.INVITE_CODE })).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects malformed input", () => expect(checkSignup({ email: "nope" }, env)).toMatchObject({ ok: false, status: 400 }));
});
