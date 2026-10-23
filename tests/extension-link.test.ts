import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bearerOf, hashSecret, makeToken, parseLinkCode, parseToken } from "@/lib/extension/link";
import { makeLinkCode } from "@/lib/extension/link-code";
import { buildQueue, itemForPage, QUEUE_LIMIT, type QueueRow } from "@/lib/extension/queue";
import { EXTENSION_VERSION } from "@/lib/extension/version";

const PID = "11111111-2222-3333-4444-555555555555";

describe("the link code", () => {
  it("round-trips the app address and the token, and the token carries its profile", () => {
    const token = makeToken(PID);
    const code = makeLinkCode("https://career.example.com/", token);
    expect(code).toBe(`https://career.example.com|${token}`);
    expect(parseLinkCode(code)).toEqual({ origin: "https://career.example.com", token });
    expect(parseToken(token)).toMatchObject({ profileId: PID });
    expect(parseToken(token)!.secret).toHaveLength(48);
  });
  it("accepts plain http only for the owner's own computer, and rejects anything malformed", () => {
    const token = makeToken("legacy");
    expect(parseLinkCode(`http://localhost:3000|${token}`)).not.toBeNull();
    expect(parseLinkCode(`http://evil.example.com|${token}`)).toBeNull();
    expect(parseLinkCode(`ftp://x.com|${token}`)).toBeNull();
    expect(parseLinkCode(`https://a.com|not-a-token`)).toBeNull();
    expect(parseLinkCode(`https://a.com|${token}|extra`)).toBeNull();
    expect(parseLinkCode("")).toBeNull();
    expect(parseLinkCode(undefined)).toBeNull();
    expect(parseToken(`${PID}.${"g".repeat(48)}`)).toBeNull();
  });
  it("only a hash of the secret is ever kept", () => {
    const t = parseToken(makeToken(PID))!;
    expect(hashSecret(t.secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(t.secret)).not.toContain(t.secret);
    expect(bearerOf("Bearer abc")).toBe("abc");
    expect(bearerOf("Basic abc")).toBeNull();
    expect(bearerOf(null)).toBeNull();
  });
});

const row = (over: Partial<QueueRow> = {}): QueueRow => ({ id: "a1", status: "assisted_pending", error: null, job: { title: "Head of AI", company: "Cygnify", url: "https://www.linkedin.com/jobs/view/1" }, finalUrl: null, resume: { name: "resume.docx" }, cover: null, ...over });

describe("the applications the extension can open", () => {
  it("opens the form where it stopped when there is one, else the job link, and says why it is waiting", () => {
    const q = buildQueue([row({ finalUrl: "https://boards.greenhouse.io/x/jobs/1" }), row({ id: "a2", status: "needs_input" }), row({ id: "a3", status: "failed" })]);
    expect(q.map((x) => x.formUrl)).toEqual(["https://boards.greenhouse.io/x/jobs/1", "https://www.linkedin.com/jobs/view/1", "https://www.linkedin.com/jobs/view/1"]);
    expect(q.map((x) => x.note)).toEqual(["Waiting for you or the assistant", "Waiting for an answer", "The assistant could not finish it"]);
  });
  it("skips an application whose link is not a web address or whose job is gone, and caps the list", () => {
    expect(buildQueue([row({ job: null }), row({ job: { title: "x", company: "y", url: "javascript:alert(1)" } }), row({ finalUrl: "file:///etc/passwd", job: { title: "x", company: "y", url: "data:text/html,hi" } })])).toEqual([]);
    expect(buildQueue(Array.from({ length: QUEUE_LIMIT + 10 }, (_, i) => row({ id: `a${i}` })))).toHaveLength(QUEUE_LIMIT);
  });
  it("matches the page you are on to its application by site, preferring one that has a resume", () => {
    const q = buildQueue([row({ id: "a", finalUrl: "https://jobs.lever.co/cyg/1", resume: null }), row({ id: "b", finalUrl: "https://jobs.lever.co/other/2" }), row({ id: "c", finalUrl: "https://careers.acme.com/x" })]);
    expect(itemForPage(q, "https://jobs.lever.co/cyg/1/apply")!.id).toBe("b");
    expect(itemForPage(q, "https://www.careers.acme.com/x")!.id).toBe("c");
    expect(itemForPage(q, "https://unknown.example.org/")).toBeNull();
    expect(itemForPage(q, "not a url")).toBeNull();
  });
});

describe("the extension package", () => {
  it("manifest version equals the version the app announces, and asks for no standing access to all sites", () => {
    const m = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    expect(m.version).toBe(EXTENSION_VERSION);
    expect(m.permissions).toEqual(["activeTab", "scripting", "storage", "alarms"]);
    expect(m.host_permissions).toBeUndefined();
    expect(m.optional_host_permissions).toContain("https://*/*");
  });
});

// --- who may call the extension endpoints ---
const state = { multi: true, record: { hash: "", created_at: "" } };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/raw-client", () => ({ rawClient: () => ({}) }));
vi.mock("@/lib/scope", () => ({ profilesEnabled: async () => state.multi }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => state.record }));

describe("who may call the extension endpoints", () => {
  beforeEach(() => { state.multi = true; state.record = { hash: "", created_at: "" }; });
  const call = async (header: string | null) => {
    const { withExtensionToken } = await import("@/lib/extension/auth");
    return withExtensionToken(new Request("https://x/api/extension/data", { headers: header ? { authorization: header } : {} }), async () => "ran");
  };
  it("lets the right code in and nothing else", async () => {
    const token = makeToken(PID);
    state.record = { hash: hashSecret(parseToken(token)!.secret), created_at: "now" };
    expect(await call(`Bearer ${token}`)).toBe("ran");
    expect(await call(`Bearer ${makeToken(PID)}`)).toBeNull(); // a different secret
    expect(await call(null)).toBeNull();
    expect(await call("Bearer nonsense")).toBeNull();
  });
  it("refuses everything once the code is revoked (no hash kept)", async () => {
    const token = makeToken(PID);
    state.record = { hash: "", created_at: "" };
    expect(await call(`Bearer ${token}`)).toBeNull();
  });
  it("a single-person (legacy) code does not work on a multi-profile app, and the reverse", async () => {
    const legacy = makeToken("legacy");
    state.record = { hash: hashSecret(parseToken(legacy)!.secret), created_at: "now" };
    expect(await call(`Bearer ${legacy}`)).toBeNull();
    state.multi = false;
    expect(await call(`Bearer ${legacy}`)).toBe("ran");
    expect(await call(`Bearer ${makeToken(PID)}`)).toBeNull();
  });
});
