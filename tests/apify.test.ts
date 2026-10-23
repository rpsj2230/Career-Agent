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
  it.each([[401, /rejected the token/], [403, /refused \(forbidden, HTTP 403\)/], [404, /no actor/], [402, /out of credit/], [400, /rejected the input/], [500, /HTTP 500/]])("explains HTTP %s", async (status, re) => {
    await expect(runActor("tok", actor, vars, respond(status).f)).rejects.toThrow(re);
  });
  it("tells a refused actor from a bad token, in Apify's own words", async () => {
    const body = (type: string, message: string) => ({ error: { type, message } });
    await expect(runActor("tok", actor, vars, respond(403, body("actor-is-not-rented", "You must rent this actor to run it")).f)).rejects.toThrow(/paid rental and its rental or trial is not active.*actor-is-not-rented.*The token is fine/);
    await expect(runActor("tok", actor, vars, respond(403, body("usage-limit", "Monthly usage hard limit exceeded")).f)).rejects.toThrow(/Apify usage limit reached.*Monthly usage hard limit exceeded.*The token is fine/);
    await expect(runActor("tok", actor, vars, respond(403, body("forbidden", "Insufficient permissions for the actor")).f)).rejects.toThrow(/no permission to run/);
    await expect(runActor("tok", actor, vars, respond(403, {}).f)).rejects.toThrow(/Check the actor's rental, your usage limits/);
    await expect(runActor("tok", actor, vars, respond(401, body("token-not-found", "User was not found or authentication token is not valid")).f)).rejects.toThrow(/rejected the token \(Apify says: token-not-found/);
  });
  describe("asks Apify what is really wrong", () => {
    // a fake Apify: the actor run is refused with `runStatus`, /users/me answers `me`, /users/me/limits answers `limits`
    const fake = (runStatus: number, me: { status: number }, limits: unknown): ApifyFetch => async (url) => {
      const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
      if (url.endsWith("/users/me")) return json(me.status, { data: {} });
      if (url.endsWith("/users/me/limits")) return json(200, limits);
      return json(runStatus, {});
    };
    it("says LIMIT, with the amounts and the reset date, when the monthly usage limit is used up (not a token problem)", async () => {
      const f = fake(403, { status: 200 }, { data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 5 }, monthlyUsageCycle: { endAt: "2026-11-01T00:00:00.000Z" } } });
      const err = await runActor("tok", actor, vars, f).catch((e: Error) => e.message);
      expect(err).toMatch(/Apify usage limit reached: \$5\.00 of \$5\.00 used this month, resets 2026-11-01/);
      expect(err).toMatch(/The token is fine/);
      expect(err).not.toMatch(/rejected the token/);
    });
    it("says TOKEN only when Apify itself does not know the token", async () => {
      const err = await runActor("tok", actor, vars, fake(403, { status: 401 }, {})).catch((e: Error) => e.message);
      expect(err).toMatch(/rejected the token/);
    });
    it("says neither when the token works and the limit is not reached", async () => {
      const f = fake(403, { status: 200 }, { data: { limits: { maxMonthlyUsageUsd: 300 }, current: { monthlyUsageUsd: 43 } } });
      const err = await runActor("tok", actor, vars, f).catch((e: Error) => e.message);
      expect(err).toMatch(/refused \(forbidden, HTTP 403\).*The token works/);
      expect(err).not.toMatch(/rejected the token|usage limit reached/);
    });
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

import { checkActorAccess, explainRefusal } from "@/lib/jobs/apify";

describe("testing whether a scraper can really run", () => {
  const actor = ApifyActor.parse({ id: "harvestapi/linkedin-job-search", portal: "linkedin", enabled: true, input: { jobTitles: ["{{title}}"], maxItems: "{{max_items}}" } });
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const NOT_APPROVED = { error: { type: "full-permission-actor-not-approved", message: "This Actor requires full access to your account. You must approve its permissions before running it: https://console.apify.com/actors/zn01OAlzP853oqn4Z?approvePermissions=1. Create a token with full access under Apify > Settings > Integrations." } };

  it("says Apify needs your approval, with the link whole, when the token is fine but the actor is not approved (the case the old test could not see)", async () => {
    const f: ApifyFetch = async (url) => (url.includes("/runs?") ? reply(403, NOT_APPROVED) : reply(200, { data: {} }));
    const r = await checkActorAccess("tok", actor, f);
    expect(r).toMatchObject({ ok: false });
    const m = (r as { message: string }).message;
    expect(m).toMatch(/needs YOUR approval/);
    expect(m).toContain("https://console.apify.com/actors/zn01OAlzP853oqn4Z?approvePermissions=1");
    expect(m).toMatch(/choose a different actor/);
  });
  it("starts a real run to find out and stops it again at once when it was allowed", async () => {
    const calls: string[] = [];
    const f: ApifyFetch = async (url, init) => { calls.push(`${init.method} ${url.replace("https://api.apify.com/v2/", "").split("?")[0]}`); return url.includes("/runs?") ? reply(201, { data: { id: "run1" } }) : reply(200, {}); };
    expect(await checkActorAccess("tok", actor, f)).toEqual({ ok: true });
    expect(calls).toEqual(["POST acts/harvestapi~linkedin-job-search/runs", "POST actor-runs/run1/abort"]);
  });
  it("counts a refusal of the sample input as allowed, and names a missing actor, a rental that ended and no credit", async () => {
    expect(await checkActorAccess("tok", actor, async () => reply(400, {}))).toEqual({ ok: true });
    expect(await checkActorAccess("tok", actor, async () => reply(404, {}))).toMatchObject({ ok: false, message: expect.stringContaining("has no actor") });
    expect(await checkActorAccess("tok", actor, async () => reply(402, {}))).toMatchObject({ ok: false, message: expect.stringContaining("out of credit") });
    expect(await checkActorAccess("tok", actor, async () => { throw new Error("offline"); })).toMatchObject({ ok: false, message: expect.stringContaining("Could not reach Apify") });
  });
  it("explainRefusal gives the approval link even when Apify's own text is long", async () => {
    const msg = await explainRefusal(403, { json: async () => NOT_APPROVED }, "harvestapi~linkedin-job-search", "tok", async () => reply(200, {}));
    expect(msg).toContain("approvePermissions=1");
  });
});
