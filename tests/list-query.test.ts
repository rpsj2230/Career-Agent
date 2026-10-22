import { describe, expect, it } from "vitest";
import {
  appQueryParams, appStageCounts, filterApps, filterJobs, jobQueryParams, jobStage, parseAppQuery, parseJobQuery, queryString, sortApps, sortJobs, stageCounts,
  type AppLight, type JobLight,
} from "@/lib/list-query";

const job = (o: Partial<JobLight> & { id: string }): JobLight => ({
  title: "Product Manager", company: "Acme", country: "sg", location: "Singapore", status: "queued", found_at: "2026-10-10T08:00:00Z", posted_at: null,
  portal: "adzuna", apply_type: "greenhouse", url: "https://boards.greenhouse.io/acme/jobs/1", score: 70, appStatus: null, ...o,
});

describe("jobStage", () => {
  it("maps job and application states to where it stands", () => {
    expect(jobStage("new", null)).toBe("unscored"); expect(jobStage("queued", null)).toBe("matched"); expect(jobStage("saved", null)).toBe("saved");
    expect(jobStage("skipped", null)).toBe("rejected"); expect(jobStage("applied", "submitted")).toBe("applied");
    expect(jobStage("prepared", "prepared")).toBe("awaiting_approval"); expect(jobStage("prepared", "approved")).toBe("sending"); expect(jobStage("prepared", "submitting")).toBe("sending");
    expect(jobStage("prepared", "assisted_pending")).toBe("waiting_assistant"); expect(jobStage("prepared", "needs_input")).toBe("needs_input"); expect(jobStage("prepared", "failed")).toBe("failed");
  });
});

describe("parseJobQuery", () => {
  it("opens on every job (nothing seems missing) and keeps the old ?view= links working", () => {
    expect(parseJobQuery({}).stages).toEqual([]);
    expect(parseJobQuery({ view: "queue" }).stages).toContain("awaiting_approval");
    expect(parseJobQuery({ view: "queue" }).stages).not.toContain("unscored");
    expect(parseJobQuery({ view: "new" }).stages).toEqual(["unscored"]);
    expect(parseJobQuery({ view: "all" }).stages).toEqual([]);
    expect(parseJobQuery({ stage: "all" }).stages).toEqual([]);
    expect(parseJobQuery({ stage: "in_progress" }).stages).toEqual(["sending"]);
  });
  it("accepts repeated and comma-separated values and drops anything invalid", () => {
    const q = parseJobQuery({ stage: ["matched", "failed,bogus"], portal: "adzuna,LinkedIn", country: ["SG", "xx1", "ae"], method: "cloud,nope", score_min: "60", score_max: "999", from: "2026-10-01", to: "not-a-date", sort: "company" });
    expect(q.stages).toEqual(["matched", "failed"]); expect(q.portals).toEqual(["adzuna", "linkedin"]); expect(q.countries).toEqual(["sg", "ae"]);
    expect(q.methods).toEqual(["cloud"]); expect(q.scoreMin).toBe(60); expect(q.scoreMax).toBe(100); expect(q.from).toBe("2026-10-01"); expect(q.to).toBeUndefined();
    expect(q.sort).toBe("company"); expect(q.dir).toBe("asc");
  });
  it("sanitises the search text and an unknown sort", () => {
    const q = parseJobQuery({ q: "  pm,(x)%  ", sort: "drop table" });
    expect(q.q).toBe("pm x"); expect(q.sort).toBe("score"); expect(q.dir).toBe("desc");
  });
});

describe("filtering and counting jobs", () => {
  const rows = [
    job({ id: "1", status: "new", score: null }),
    job({ id: "2", status: "queued", score: 90, company: "Zeta", country: "ae", portal: "linkedin", apply_type: "linkedin", url: "https://linkedin.com/jobs/view/1" }),
    job({ id: "3", status: "prepared", appStatus: "prepared", score: 80, title: "Growth Lead", company: "Beta" }),
    job({ id: "4", status: "prepared", appStatus: "failed", score: 60 }),
    job({ id: "5", status: "skipped", score: 20, found_at: "2026-09-01T00:00:00Z" }),
  ];
  it("filters by stage, text, score, date, portal, country and apply method", () => {
    expect(filterJobs(rows, parseJobQuery({ stage: "awaiting_approval" })).map((r) => r.id)).toEqual(["3"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", q: "growth" })).map((r) => r.id)).toEqual(["3"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", q: "zeta product" })).map((r) => r.id)).toEqual(["2"]); // every word must match something
    expect(filterJobs(rows, parseJobQuery({ stage: "all", score_min: "75" })).map((r) => r.id).sort()).toEqual(["2", "3"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", from: "2026-10-01" })).map((r) => r.id).sort()).toEqual(["1", "2", "3", "4"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", portal: "linkedin" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", country: "ae" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterJobs(rows, parseJobQuery({ stage: "all", method: "assistant" })).map((r) => r.id)).toEqual(["2"]);
  });
  it("counts every stage for the chips", () => {
    const c = stageCounts(rows);
    expect(c).toMatchObject({ unscored: 1, matched: 1, awaiting_approval: 1, failed: 1, rejected: 1, applied: 0 });
  });
});

describe("sorting jobs", () => {
  const rows = [
    job({ id: "a", score: 50, company: "Beta", found_at: "2026-10-02T00:00:00Z", posted_at: "2026-10-01T00:00:00Z", country: "sg" }),
    job({ id: "b", score: null, company: "alpha", found_at: "2026-10-05T00:00:00Z", country: null }),
    job({ id: "c", score: 90, company: "Gamma", found_at: "2026-10-01T00:00:00Z", posted_at: "2026-10-04T00:00:00Z", country: "ae" }),
  ];
  const ids = (s: Parameters<typeof sortJobs>[1], d: "asc" | "desc") => sortJobs(rows, s, d).map((r) => r.id).join("");
  it("sorts by each key in both directions and puts missing values last", () => {
    expect(ids("score", "desc")).toBe("cab"); expect(ids("score", "asc")).toBe("acb");
    expect(ids("found", "desc")).toBe("bac"); expect(ids("found", "asc")).toBe("cab");
    expect(ids("posted", "desc")).toBe("cab"); expect(ids("posted", "asc")).toBe("acb");
    expect(ids("company", "asc")).toBe("bac"); expect(ids("company", "desc")).toBe("cab");
    expect(ids("country", "asc")).toBe("cab"); expect(ids("country", "desc")).toBe("acb"); // ae, sg; no country last either way
  });
});

describe("applications", () => {
  const apps: AppLight[] = [
    { id: "1", status: "prepared", method: null, lifecycle: "none", submitted_at: null, created_at: "2026-10-10T00:00:00Z", title: "PM", company: "Acme", country: "sg", portal: "adzuna", apply_type: "greenhouse", url: "https://boards.greenhouse.io/a/jobs/1" },
    { id: "2", status: "submitted", method: "automated", lifecycle: "interview", submitted_at: "2026-10-12T00:00:00Z", created_at: "2026-10-08T00:00:00Z", title: "Growth", company: "Beta", country: "ae", portal: "linkedin", apply_type: "linkedin", url: "https://linkedin.com/jobs/view/2" },
    { id: "3", status: "failed", method: "automated", lifecycle: "none", submitted_at: null, created_at: "2026-10-09T00:00:00Z", title: "Ops", company: "Gamma", country: "sg", portal: "adzuna", apply_type: "greenhouse", url: "https://boards.greenhouse.io/c/jobs/3" },
  ];
  it("keeps the old ?status= links and filters by stage, outcome, method and date sent", () => {
    expect(parseAppQuery({ status: "pending" }).stages).toEqual(["awaiting_approval"]);
    expect(filterApps(apps, parseAppQuery({ stage: "failed,applied" })).map((r) => r.id).sort()).toEqual(["2", "3"]);
    expect(filterApps(apps, parseAppQuery({ lifecycle: "interview" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterApps(apps, parseAppQuery({ method: "assistant" })).map((r) => r.id)).toEqual(["2"]);
    expect(filterApps(apps, parseAppQuery({ sent_from: "2026-10-11" })).map((r) => r.id)).toEqual(["2"]);
    expect(appStageCounts(apps)).toMatchObject({ awaiting_approval: 1, applied: 1, failed: 1 });
  });
  it("sorts by date submitted with unsent last, and by company", () => {
    expect(sortApps(apps, "submitted", "desc").map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(sortApps(apps, "company", "asc").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("links", () => {
  it("builds compact URLs that round-trip", () => {
    const q = parseJobQuery({ stage: ["matched", "failed"], portal: "adzuna", q: "pm", sort: "company", dir: "desc" });
    const qs = queryString(jobQueryParams(q));
    expect(qs).toContain("stage=matched&stage=failed"); expect(qs).toContain("sort=company"); expect(qs).toContain("dir=desc");
    const back = parseJobQuery(Object.fromEntries(new URLSearchParams(qs).entries()) as never);
    expect(back.sort).toBe("company"); expect(back.dir).toBe("desc");
    expect(queryString(jobQueryParams(parseJobQuery({})))).toBe(""); // the default view has a clean URL
    expect(queryString(jobQueryParams(parseJobQuery({ stage: "all" })))).toBe(""); // all jobs is the default
    expect(queryString(jobQueryParams(parseJobQuery({ stage: "applied" })))).toBe("?stage=applied");
    expect(queryString(appQueryParams(parseAppQuery({ stage: "failed" }), { page: 2 }))).toBe("?stage=failed&page=2");
  });
});

import { parseLogFilters } from "@/lib/log-filters";
import { activePills, ROUTE_LABEL } from "@/lib/list-query";
describe("log order and filter pills", () => {
  it("accepts oldest first and ignores anything else", () => {
    expect(parseLogFilters({ order: "oldest" }).order).toBe("oldest");
    expect(parseLogFilters({ order: "sideways" }).order).toBeUndefined();
  });
  it("makes one removable pill per applied filter, none for the default view", () => {
    const names = { portal: (k: string) => k, country: (k: string) => k.toUpperCase(), stage: (k: string) => k };
    expect(activePills("jobs", parseJobQuery({}), names as never, [])).toHaveLength(parseJobQuery({}).stages.length);
    const q = parseJobQuery({ stage: "all", country: "sg,ae", method: "cloud", score_min: "70", q: "pm" });
    const pills = activePills("jobs", q, names as never);
    expect(pills.map((p) => p.label)).toEqual(["Country: SG", "Country: AE", `Applied via: ${ROUTE_LABEL.cloud}`, "Search: “pm”", "Score ≥ 70"]);
    expect(pills[0].over).toMatchObject({ country: ["ae"] });
  });
});

describe("found via", () => {
  const rows = [
    job({ id: "a", source: "mailbox", portal: "linkedin" }), job({ id: "b", source: "adzuna", portal: "adzuna" }),
    job({ id: "c", source: "apify:curious_coder~linkedin", portal: "linkedin" }), job({ id: "d", source: null }),
  ];
  it("reads the filter from the address and keeps only valid names", () => {
    expect(parseJobQuery({ via: ["mailbox", "Bad Name!", "apify"] }).vias).toEqual(["mailbox", "apify"]);
    expect(parseJobQuery({}).vias).toEqual([]);
  });
  it("keeps the jobs that reached the app that way, whatever the portal they are on", () => {
    const q = (vias: string[]) => ({ ...parseJobQuery({ stage: "all" }), vias });
    expect(filterJobs(rows, q(["mailbox"])).map((r) => r.id)).toEqual(["a"]);
    expect(filterJobs(rows, q(["apify"])).map((r) => r.id)).toEqual(["c"]);
    expect(filterJobs(rows, q(["mailbox", "adzuna"])).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterJobs(rows, q([])).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("is part of the address and of the removable pills", () => {
    const q = { ...parseJobQuery({ stage: "all", via: ["mailbox"] }) };
    expect(jobQueryParams(q)).toMatchObject({ via: ["mailbox"] });
    expect(activePills("jobs", q, { portal: (k) => k, via: (k) => `via ${k}`, country: (k) => k, stage: (k) => k }).map((p) => p.label)).toContain("Found via: via mailbox");
  });
});

describe("job groups", () => {
  it("cover every pipeline stage exactly once, so the group counts add up to all jobs", async () => {
    const { JOB_GROUPS, STAGE_ORDER } = await import("@/lib/list-query");
    expect(JOB_GROUPS.flatMap((g) => g.stages).sort()).toEqual([...STAGE_ORDER].sort());
  });
});
