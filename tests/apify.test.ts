import { describe, expect, it } from "vitest";
import { ApifyActor, fillTemplate, mapApifyItem, runActor, templateVars, type ApifyFetch } from "@/lib/jobs/apify";

const vars = templateVars({ title: "Product Manager", location: "Singapore", country: "sg" }, 14, 40);

describe("fillTemplate", () => {
  it("fills placeholders anywhere and keeps numbers as numbers", () => {
    const out = fillTemplate({ keywords: "{{title}}", location: "{{location}}, {{country_name}}", maxItems: "{{max_items}}", filters: { days: "{{days}}", list: ["{{title}}", "x"] }, keep: "{{unknown}}" }, vars);
    expect(out).toEqual({ keywords: "Product Manager", location: "Singapore, Singapore", maxItems: 40, filters: { days: 14, list: ["Product Manager", "x"] }, keep: "{{unknown}}" });
  });
  it("does not change the template it was given", () => {
    const t = { a: "{{title}}" };
    fillTemplate(t, vars);
    expect(t).toEqual({ a: "{{title}}" });
  });
});

describe("mapApifyItem", () => {
  const actor = { id: "someone~linkedin-jobs", portal: "linkedin" };
  it("reads a LinkedIn-style item", () => {
    const j = mapApifyItem({ id: "3847", title: "Senior Product Manager", companyName: "Acme", location: "Singapore", jobUrl: "https://www.linkedin.com/jobs/view/3847", descriptionText: "Own the roadmap.", postedAt: "2026-10-10", salary: "SGD 9,000 - 12,000" }, actor, "sg")!;
    expect(j).toMatchObject({ source: "apify:someone~linkedin-jobs", externalId: "3847", title: "Senior Product Manager", company: "Acme", country: "sg", url: "https://www.linkedin.com/jobs/view/3847", publisher: "linkedin", salaryText: "SGD 9,000 - 12,000" });
    expect(j.postedAt).toBe("2026-10-10T00:00:00.000Z");
  });
  it("reads a differently named item (nested company, array location, html description, unix date)", () => {
    const j = mapApifyItem({ jobId: 99, jobTitle: "Product Manager", hiringOrganization: { name: "Beta Ltd" }, locations: ["Bengaluru", "Pune"], jdURL: "https://www.naukri.com/job-listings-x-99", jobDescription: "<p>Own <b>roadmaps</b></p><ul><li>SQL</li></ul>", datePosted: 1760000000 }, { id: "x~naukri", portal: "naukri" })!;
    expect(j).toMatchObject({ title: "Product Manager", company: "Beta Ltd", location: "Bengaluru, Pune", country: "in", externalId: "99" });
    expect(j.description).toContain("Own roadmaps");
    expect(j.description).not.toContain("<");
    expect(j.postedAt).toMatch(/^2025-/);
  });
  it("prefers the employer's Greenhouse or Lever page, which can be applied for automatically", () => {
    const j = mapApifyItem({ title: "PM", companyName: "Acme", jobUrl: "https://www.linkedin.com/jobs/view/1", applyUrl: "https://boards.greenhouse.io/acme/jobs/55" }, actor)!;
    expect(j.url).toBe("https://boards.greenhouse.io/acme/jobs/55");
    const k = mapApifyItem({ title: "PM", companyName: "Acme", jobUrl: "https://www.linkedin.com/jobs/view/1", applyUrl: "https://careers.acme.com/apply/1" }, actor)!;
    expect(k.url).toBe("https://www.linkedin.com/jobs/view/1");
  });
  it("skips items with no title or no usable link, and tolerates junk", () => {
    expect(mapApifyItem({ companyName: "A", jobUrl: "https://x.com/1" }, actor)).toBeNull();
    expect(mapApifyItem({ title: "PM", companyName: "A" }, actor)).toBeNull();
    expect(mapApifyItem({ title: "PM", jobUrl: "javascript:alert(1)" }, actor)).toBeNull();
    expect(mapApifyItem(null, actor)).toBeNull();
    expect(mapApifyItem("text", actor)).toBeNull();
  });
  it("gives an item with no id a stable one", () => {
    const a = mapApifyItem({ title: "PM", jobUrl: "https://x.com/jobs/1" }, actor)!, b = mapApifyItem({ title: "PM", jobUrl: "https://x.com/jobs/1" }, actor)!;
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).not.toBe(mapApifyItem({ title: "PM", jobUrl: "https://x.com/jobs/2" }, actor)!.externalId);
  });
});

describe("actor settings", () => {
  it("accepts both id spellings and rejects nonsense", () => {
    expect(ApifyActor.safeParse({ id: "user~actor", portal: "linkedin" }).success).toBe(true);
    expect(ApifyActor.safeParse({ id: "user/actor", portal: "linkedin" }).success).toBe(true);
    expect(ApifyActor.safeParse({ id: "just-a-name", portal: "linkedin" }).success).toBe(false);
    expect(ApifyActor.safeParse({ id: "u~a", portal: "" }).success).toBe(false);
  });
});

describe("runActor", () => {
  const actor = ApifyActor.parse({ id: "user/actor", portal: "linkedin", input: { q: "{{title}}", n: "{{max_items}}" }, max_items: 25 });
  const respond = (status: number, body: unknown = []): { calls: { url: string; init: Parameters<ApifyFetch>[1] }[]; f: ApifyFetch } => {
    const calls: { url: string; init: Parameters<ApifyFetch>[1] }[] = [];
    return { calls, f: async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; } };
  };
  it("posts the filled input with the token and returns the items", async () => {
    const r = respond(200, [{ title: "x" }]);
    expect(await runActor("tok", actor, vars, r.f)).toEqual([{ title: "x" }]);
    expect(r.calls[0].url).toContain("/v2/acts/user~actor/run-sync-get-dataset-items");
    expect(r.calls[0].url).toContain("limit=25");
    expect(r.calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(r.calls[0].init.body!)).toEqual({ q: "Product Manager", n: 40 });
  });
  it.each([[401, /rejected the token/], [404, /no actor/], [402, /out of credit/], [400, /rejected the input/], [500, /HTTP 500/]])("explains HTTP %s", async (status, re) => {
    await expect(runActor("tok", actor, vars, respond(status).f)).rejects.toThrow(re);
  });
  it("explains an unreachable network and tolerates a non-list answer", async () => {
    await expect(runActor("tok", actor, vars, async () => { throw new Error("ECONNRESET"); })).rejects.toThrow(/Could not reach Apify/);
    expect(await runActor("tok", actor, vars, respond(200, { oops: true }).f)).toEqual([]);
  });
});

describe("presets and country limits", () => {
  it("every preset is a valid actor row with a fillable input", async () => {
    const { APIFY_PRESETS } = await import("@/lib/jobs/apify-presets");
    expect(APIFY_PRESETS.map((p) => p.key)).toEqual(["linkedin", "indeed", "naukri", "seek"]);
    for (const p of APIFY_PRESETS) {
      expect(ApifyActor.safeParse(p.actor).success).toBe(true);
      const filled = JSON.stringify(fillTemplate(p.actor.input, templateVars({ title: "Product Manager", location: "Sydney", country: "au" }, 3, 25)));
      expect(filled).not.toMatch(/\{\{/);
      expect(filled).toContain("Product Manager");
    }
  });
  it("rounds the age window to what scrapers offer", () => {
    const v = (d: number) => templateVars({ title: "x", country: "in" }, d, 10);
    expect([v(1), v(5), v(20)].map((x) => x.posted_bucket)).toEqual(["24h", "week", "month"]);
    expect([v(1), v(2), v(5), v(10), v(30)].map((x) => x.posted_days)).toEqual([1, 3, 7, 14, 14]);
    expect(v(5).country_lower).toBe("in");
  });
  it("keeps a numeric limit numeric after filling", async () => {
    const { APIFY_PRESETS } = await import("@/lib/jobs/apify-presets");
    const f = fillTemplate(APIFY_PRESETS[2].actor.input, templateVars({ title: "PM", country: "in" }, 3, 25)) as Record<string, unknown>;
    expect(f.maxJobs).toBe(25);
  });
});
