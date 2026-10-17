import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isPrivateAddress, isRedirector, resolveFinalUrl, upgradeApplyTarget, type ResolveDeps } from "@/lib/jobs/resolve-url";

const fake = (map: Record<string, { status: number; location?: string }>, dns: Record<string, string[]> = {}): ResolveDeps & { fetched: string[] } => {
  const fetched: string[] = [];
  return {
    fetched,
    lookup: async (h) => dns[h] ?? ["93.184.216.34"],
    fetch: async (url) => { fetched.push(url); const r = map[url] ?? { status: 200 }; return { status: r.status, headers: { get: (n: string) => (n.toLowerCase() === "location" ? r.location ?? null : null) }, body: null }; },
  };
};

describe("addresses that are never fetched", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"])("%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1"])("%s is public", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("resolveFinalUrl", () => {
  it("follows redirects to the final page", async () => {
    const d = fake({ "https://www.adzuna.sg/land/ad/1": { status: 302, location: "https://boards.greenhouse.io/acme/jobs/9" } });
    expect(await resolveFinalUrl("https://www.adzuna.sg/land/ad/1", d)).toBe("https://boards.greenhouse.io/acme/jobs/9");
    expect(d.fetched).toHaveLength(2);
  });
  it("resolves relative redirects and stops after the maximum number of hops", async () => {
    const d = fake({ "https://a.example/x": { status: 301, location: "/y" }, "https://a.example/y": { status: 200 } });
    expect(await resolveFinalUrl("https://a.example/x", d)).toBe("https://a.example/y");
    const loop = fake({ "https://l.example/a": { status: 302, location: "https://l.example/a" } });
    expect(await resolveFinalUrl("https://l.example/a", loop, 3)).toBeNull();
  });
  it("refuses internal targets, at the start and in the middle of a redirect chain", async () => {
    expect(await resolveFinalUrl("http://localhost/x", fake({}))).toBeNull();
    expect(await resolveFinalUrl("http://169.254.169.254/latest/meta-data", fake({}))).toBeNull();
    expect(await resolveFinalUrl("https://evil.example/x", fake({}, { "evil.example": ["10.0.0.5"] }))).toBeNull();
    const d = fake({ "https://www.adzuna.sg/land/ad/2": { status: 302, location: "http://169.254.169.254/" } });
    expect(await resolveFinalUrl("https://www.adzuna.sg/land/ad/2", d)).toBeNull();
    expect(d.fetched).toEqual(["https://www.adzuna.sg/land/ad/2"]); // the internal address was never requested
  });
  it("only http and https, and never throws on garbage or a failing network", async () => {
    expect(await resolveFinalUrl("file:///etc/passwd", fake({}))).toBeNull();
    expect(await resolveFinalUrl("not a url", fake({}))).toBeNull();
    const down: ResolveDeps = { lookup: async () => ["93.184.216.34"], fetch: async () => { throw new Error("ECONNRESET"); } };
    expect(await resolveFinalUrl("https://x.example/", down)).toBeNull();
  });
});

describe("upgradeApplyTarget", () => {
  it("only looks at tracker links", () => {
    expect(isRedirector("https://www.adzuna.sg/land/ad/1")).toBe(true);
    expect(isRedirector("https://boards.greenhouse.io/acme/jobs/1")).toBe(false);
  });
  it("switches to the employer's Greenhouse or Lever page, which can be applied for automatically", async () => {
    const gh = fake({ "https://www.adzuna.com/land/ad/1": { status: 302, location: "https://boards.greenhouse.io/acme/jobs/9" } });
    expect(await upgradeApplyTarget({ url: "https://www.adzuna.com/land/ad/1", apply_type: "unknown" }, gh)).toEqual({ url: "https://boards.greenhouse.io/acme/jobs/9", apply_type: "greenhouse" });
    const lv = fake({ "https://www.adzuna.com/land/ad/2": { status: 302, location: "https://jobs.lever.co/acme/abc" } });
    expect((await upgradeApplyTarget({ url: "https://www.adzuna.com/land/ad/2", apply_type: "unknown" }, lv))?.apply_type).toBe("lever");
  });
  it("leaves everything else alone", async () => {
    const other = fake({ "https://www.adzuna.com/land/ad/3": { status: 302, location: "https://careers.bigco.com/job/3" } });
    expect(await upgradeApplyTarget({ url: "https://www.adzuna.com/land/ad/3", apply_type: "unknown" }, other)).toBeNull();
    expect(await upgradeApplyTarget({ url: "https://www.linkedin.com/jobs/view/1", apply_type: "linkedin" }, fake({}))).toBeNull();
  });
});
