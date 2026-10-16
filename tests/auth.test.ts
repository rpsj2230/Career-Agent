import { describe, expect, it } from "vitest";
import { checkAuth } from "@/lib/auth";

const basic = (pw: string) => "Basic " + Buffer.from(`me:${pw}`).toString("base64");
const env = { APP_PASSWORD: "s3cret", CRON_SECRET: "cron-token" };

describe("checkAuth", () => {
  it("fails closed without APP_PASSWORD", () => expect(checkAuth("/", basic("x"), {})).toMatchObject({ ok: false, status: 503 }));
  it("rejects missing or wrong credentials", () => {
    expect(checkAuth("/", null, env)).toMatchObject({ ok: false, status: 401 });
    expect(checkAuth("/", basic("nope"), env)).toMatchObject({ ok: false, status: 401 });
  });
  it("accepts the password with any username, including colons in the password", () => {
    expect(checkAuth("/", basic("s3cret"), env).ok).toBe(true);
    expect(checkAuth("/", basic("a:b"), { APP_PASSWORD: "a:b" }).ok).toBe(true);
  });
  it("accepts the cron bearer token only on /api/cron/*", () => {
    expect(checkAuth("/api/cron/discover", "Bearer cron-token", env).ok).toBe(true);
    expect(checkAuth("/api/profile/confirm", "Bearer cron-token", env).ok).toBe(false);
    expect(checkAuth("/api/cron/discover", "Bearer wrong", env).ok).toBe(false);
  });
});
