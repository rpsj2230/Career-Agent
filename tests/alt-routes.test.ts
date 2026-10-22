import { describe, expect, it } from "vitest";
import { alternativeRoutes, atsLinksIn, findOnEmployerBoards, placesAgree, slugCandidates, titleSimilarity } from "@/lib/jobs/alt-routes";

describe("slugCandidates", () => {
  it("turns a company name into likely board names", () => {
    expect(slugCandidates("Natural Selection Group Pty Ltd")).toEqual(expect.arrayContaining(["naturalselection", "natural-selection", "naturalselectiongroup"]));
    expect(slugCandidates("Zeller")).toEqual(["zeller"]);
    expect(slugCandidates("MORGAN MCKINLEY PTE. LTD.")).toEqual(expect.arrayContaining(["morganmckinley", "morgan-mckinley"]));
  });
  it("gives nothing for a name with no usable words and never an unsafe board name", () => {
    expect(slugCandidates("Pty Ltd")).toEqual([]);
    for (const s of slugCandidates("Böse & Söhne / evil.com?x=1 GmbH")) expect(s).toMatch(/^[a-z0-9][a-z0-9-]{2,40}$/);
  });
});

describe("titleSimilarity", () => {
  it("is 1 for the same words, and ignores order, brackets, location suffixes and filler", () => {
    expect(titleSimilarity("Senior Product Manager", "Product Manager, Senior")).toBe(1);
    expect(titleSimilarity("Product Manager - Remote", "Product Manager")).toBe(1);
    expect(titleSimilarity("Product Manager (Payments)", "Product Manager")).toBe(1);
    expect(titleSimilarity("Senior Product Manager | 12 month FTC", "Senior Product Manager")).toBe(1);
  });
  it("is low for a different role", () => {
    expect(titleSimilarity("Product Manager", "Product Marketing Manager")).toBeLessThan(0.85);
    expect(titleSimilarity("Director of Product Management", "Product Manager")).toBeLessThan(0.85);
    expect(titleSimilarity("", "Product Manager")).toBe(0);
  });
});

describe("placesAgree", () => {
  it("needs a shared city or country when both are known", () => {
    expect(placesAgree("Melbourne, Australia", "Melbourne VIC")).toBe(true);
    expect(placesAgree("Melbourne, Australia", "Bengaluru, India")).toBe(false);
    expect(placesAgree(null, "Anywhere")).toBe(true);
    expect(placesAgree("Remote", "Berlin")).toBe(true);
  });
});

describe("atsLinksIn", () => {
  it("finds applicant-tracking links in a description and skips job-board links", () => {
    const d = atsLinksIn("Apply here: https://boards.greenhouse.io/acme/jobs/123. More at https://www.adzuna.com/land/ad/9 or https://jobs.lever.co/acme/abc-def, thanks");
    expect(d.map((x) => [x.ats, x.url])).toEqual([["greenhouse", "https://boards.greenhouse.io/acme/jobs/123"], ["lever", "https://jobs.lever.co/acme/abc-def"]]);
    expect(atsLinksIn(null)).toEqual([]);
  });
});

const board = (jobs: unknown[]) => ({ jobs });
const net = (map: Record<string, unknown>) => ({ getJson: async (url: string) => map[url] ?? null });

describe("findOnEmployerBoards", () => {
  const job = { title: "Mid-Level Product Manager", company: "Zeller Pty Ltd", location: "Sydney NSW" };
  it("finds the same job on the employer's Greenhouse board", async () => {
    const found = await findOnEmployerBoards(job, net({ "https://boards-api.greenhouse.io/v1/boards/zeller/jobs": board([{ id: 1, title: "Mid-Level Product Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/1", location: { name: "Sydney, Australia" } }, { id: 2, title: "Data Engineer", absolute_url: "https://boards.greenhouse.io/zeller/jobs/2", location: { name: "Sydney" } }]) }));
    expect(found).toMatchObject({ url: "https://boards.greenhouse.io/zeller/jobs/1", ats: "greenhouse" });
  });
  it("finds it on a Lever board too", async () => {
    const found = await findOnEmployerBoards(job, net({ "https://api.lever.co/v0/postings/zeller?mode=json": [{ id: "x", text: "Mid-Level Product Manager", hostedUrl: "https://jobs.lever.co/zeller/x", categories: { location: "Sydney" } }] }));
    expect(found).toMatchObject({ url: "https://jobs.lever.co/zeller/x", ats: "lever" });
  });
  it("does not accept a different role or another country's posting", async () => {
    expect(await findOnEmployerBoards(job, net({ "https://boards-api.greenhouse.io/v1/boards/zeller/jobs": board([{ id: 1, title: "Product Marketing Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/1", location: { name: "Sydney" } }]) }))).toBeNull();
    expect(await findOnEmployerBoards(job, net({ "https://boards-api.greenhouse.io/v1/boards/zeller/jobs": board([{ id: 1, title: "Mid-Level Product Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/1", location: { name: "Bengaluru, India" } }]) }))).toBeNull();
  });
  it("gives nothing when two different postings match equally well", async () => {
    const two = board([{ id: 1, title: "Mid-Level Product Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/1", location: { name: "Sydney" } }, { id: 2, title: "Mid Level Product Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/2", location: { name: "Sydney" } }]);
    expect(await findOnEmployerBoards(job, net({ "https://boards-api.greenhouse.io/v1/boards/zeller/jobs": two }))).toBeNull();
  });
  it("survives a board that does not exist or a network that fails", async () => {
    expect(await findOnEmployerBoards(job, net({}))).toBeNull();
    expect(await findOnEmployerBoards(job, { getJson: async () => { throw new Error("boom"); } })).toBeNull();
  });
});

describe("alternativeRoutes", () => {
  it("lists links named in the description before the employer's board", async () => {
    const routes = await alternativeRoutes({ title: "Mid-Level Product Manager", company: "Zeller", description: "Apply: https://jobs.ashbyhq.com/zeller/abc" }, net({ "https://boards-api.greenhouse.io/v1/boards/zeller/jobs": board([{ id: 1, title: "Mid-Level Product Manager", absolute_url: "https://boards.greenhouse.io/zeller/jobs/1" }]) }));
    expect(routes.map((r) => r.ats)).toEqual(["ashby", "greenhouse"]);
  });
});
