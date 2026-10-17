import { describe, expect, it } from "vitest";
import { checkKey, keyProblems } from "@/lib/keycheck";
import { diagnosis } from "@/lib/signup";

const jwt = (p: object) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(p)).toString("base64url")}.sig`;
const URL = "https://abcdefgh.supabase.co";

describe("key check", () => {
  it("accepts a service_role key for the same project", () => {
    const r = checkKey(jwt({ role: "service_role", ref: "abcdefgh", exp: 4102444800 }), URL);
    expect(r).toMatchObject({ kind: "service_role", sameProject: true });
    expect(keyProblems(r)).toEqual([]);
  });
  it("spots the anon key", () => expect(keyProblems(checkKey(jwt({ role: "anon", ref: "abcdefgh" }), URL))[0]).toMatch(/anon key/));
  it("spots a key from another project", () => expect(keyProblems(checkKey(jwt({ role: "service_role", ref: "zzzzzzzz" }), URL)).join(" ")).toMatch(/belongs to project "zzzzzzzz".*"abcdefgh"/));
  it("spots publishable, secret, missing and junk keys", () => {
    expect(checkKey("sb_publishable_x", URL).kind).toBe("publishable");
    expect(keyProblems(checkKey("sb_publishable_x", URL))[0]).toMatch(/publishable/);
    expect(checkKey("sb_secret_x", URL)).toMatchObject({ kind: "secret" });
    expect(keyProblems(checkKey("sb_secret_x", URL))).toEqual([]);
    expect(checkKey(undefined, URL).kind).toBe("missing");
    expect(checkKey("hello", URL).kind).toBe("unknown");
  });
  it("spots stray whitespace, expiry and a bad URL", () => {
    expect(checkKey(`${jwt({ role: "service_role", ref: "abcdefgh" })}\n`, URL).whitespace).toBe(true);
    expect(checkKey(jwt({ role: "service_role", exp: 1 }), URL).expired).toBe(true);
    expect(keyProblems(checkKey(jwt({ role: "service_role" }), "https://abcdefgh.supabase.co/rest/v1")).join(" ")).toMatch(/SUPABASE_URL/);
  });
  it("never echoes the key and includes Supabase's own words", () => {
    const key = jwt({ role: "anon", ref: "abcdefgh" });
    const d = diagnosis("Invalid API key", 401, { key, url: URL });
    expect(d).toContain("anon key");
    expect(d).toContain('Supabase said: "Invalid API key" (HTTP 401)');
    expect(d).not.toContain(key);
  });
});
