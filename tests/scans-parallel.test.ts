import { describe, expect, it } from "vitest";
import { runScans, type ScanDeps } from "@/lib/jobs/scans";
import type { NormalizedJob } from "@/lib/jobs/normalize";
import type { ScanSpec } from "@/lib/jobs/sources";

const job = (id: string): NormalizedJob => ({ source: "s", externalId: id, title: "PM", company: "A", url: "https://x.com/" + id, description: "d" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deps = (log: string[]): ScanDeps => ({
  startScan: async (m) => { log.push(`start ${m.integration}:${m.query}`); return "id"; },
  finishScan: async () => undefined,
  ingest: async (jobs) => { log.push(`ingest ${jobs.map((j) => j.externalId).join(",")}`); return { inserted: jobs.length, duplicates: 0, stale: 0, invalid: 0 }; },
  recordIntegration: async () => undefined,
});

describe("runScans: fetch in parallel, store in order", () => {
  it("different integrations fetch at the same time, so a slow scraper does not hold up the quick feeds", async () => {
    const t0 = Date.now();
    const specs: ScanSpec[] = [
      { integration: "apify", query: "a", fetch: async () => { await sleep(150); return [job("1")]; } },
      { integration: "jsearch", query: "b", fetch: async () => { await sleep(150); return [job("2")]; } },
      { integration: "adzuna", query: "c", fetch: async () => { await sleep(150); return [job("3")]; } },
    ];
    const r = await runScans(specs, deps([]));
    expect(Date.now() - t0).toBeLessThan(400); // sequential would be 450+
    expect(r.outcomes.map((o) => o.ok)).toEqual([true, true, true]);
  });

  it("requests to the same integration stay one after another (rate limits), and storing keeps the original order", async () => {
    const log: string[] = [];
    let running = 0, peak = 0;
    const slow = (id: string, ms: number): ScanSpec["fetch"] => async () => { running++; peak = Math.max(peak, running); await sleep(ms); running--; return [job(id)]; };
    const specs: ScanSpec[] = [
      { integration: "apify", query: "1", fetch: slow("a1", 60) },
      { integration: "jsearch", query: "2", fetch: slow("j1", 5) },
      { integration: "apify", query: "3", fetch: slow("a2", 5) },
    ];
    await runScans(specs, deps(log));
    expect(peak).toBe(2); // one apify + one jsearch at a time, never two apify
    expect(log.filter((l) => l.startsWith("ingest"))).toEqual(["ingest a1", "ingest j1", "ingest a2"]);
  });

  it("a failing fetch is recorded for that scan only", async () => {
    const specs: ScanSpec[] = [
      { integration: "apify", query: "x", fetch: async () => { throw new Error("actor failed"); } },
      { integration: "jsearch", query: "y", fetch: async () => [job("9")] },
    ];
    const r = await runScans(specs, deps([]));
    expect(r.outcomes.map((o) => [o.integration, o.ok, o.error])).toEqual([["apify", false, "actor failed"], ["jsearch", true, undefined]]);
  });

  it("stops starting new fetches once the time budget is used up and says how many were left", async () => {
    let t = 0;
    const d = { ...deps([]), now: () => t };
    const specs: ScanSpec[] = [
      { integration: "apify", query: "1", fetch: async () => { t += 100; return [job("1")]; } },
      { integration: "apify", query: "2", fetch: async () => [job("2")] },
      { integration: "apify", query: "3", fetch: async () => [job("3")] },
    ];
    const r = await runScans(specs, d, { budgetMs: 50 });
    expect(r.outcomes).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });

  it("never waits past the budget for a slow source: the reply is on time and the slow scan is reported as not finished", async () => {
    const d = deps([]);
    const specs: ScanSpec[] = [
      { integration: "jsearch", query: "fast", fetch: async () => [job("1")] },
      { integration: "apify", query: "minutes", fetch: () => new Promise<NormalizedJob[]>((r) => setTimeout(() => r([job("2")]), 5_000)) },
    ];
    const t0 = Date.now();
    const r = await runScans(specs, d, { budgetMs: 150 });
    expect(Date.now() - t0).toBeLessThan(1_000); // not 5 s
    expect(r.outcomes.map((o) => o.query)).toEqual(["fast"]);
    expect(r.skipped).toBe(1);
  });
});
