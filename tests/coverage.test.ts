import { describe, expect, it } from "vitest";
import { coverageFor } from "@/lib/integrations/coverage";
import type { ConnectionStatus, IntegrationId } from "@/lib/integrations/catalog";

const st = (ready: IntegrationId[]) => (id: IntegrationId): ConnectionStatus => (ready.includes(id) ? "ok" : "needs_setup");

describe("coverage per country", () => {
  it("Singapore with Adzuna, MyCareersFuture and the alert mailbox is good", () => {
    const c = coverageFor("sg", st(["adzuna", "mcf", "mailbox"]), false);
    expect(c.level).toBe("good");
    expect(c.sources.filter((s) => s.usable).map((s) => s.id)).toEqual(expect.arrayContaining(["adzuna", "mcf", "mailbox"]));
  });
  it("the UAE is not served by Adzuna, and the advice says what to use instead", () => {
    const c = coverageFor("ae", st(["jsearch"]), false);
    expect(c.sources.some((s) => s.id === "adzuna")).toBe(false);
    expect(c.level).toBe("thin");
    expect(c.advice.join(" ")).toMatch(/Adzuna does not cover AE/);
    expect(c.advice.join(" ")).toMatch(/Bayt/);
  });
  it("the UAE with JSearch and the mailbox is partial", () => {
    expect(coverageFor("ae", st(["jsearch", "mailbox"]), false).level).toBe("partial");
  });
  it("remote-only feeds do not count as country coverage", () => {
    expect(coverageFor("in", st(["remotive", "remoteok", "jobicy"]), false).level).toBe("thin");
  });
  it("hosted scrapers count only once a scraper is configured", () => {
    expect(coverageFor("in", st(["apify"]), false).sources.find((s) => s.id === "apify")?.usable).toBe(false);
    expect(coverageFor("in", st(["apify"]), true).sources.find((s) => s.id === "apify")?.usable).toBe(true);
  });
  it("unconnected sources are suggested, free ones first in the advice", () => {
    const a = coverageFor("in", st([]), false).advice.join(" ");
    expect(a).toMatch(/Connect Adzuna/);
    expect(a).toMatch(/Naukri/);
  });
  it("labels every source with what it costs", () => {
    for (const s of coverageFor("us", st([]), false).sources) expect(s.cost.note.length).toBeGreaterThan(3);
  });
});
