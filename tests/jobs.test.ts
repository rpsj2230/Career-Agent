import { describe, expect, it } from "vitest";
import { dedupeKey, detectApplyType, guessCountry, htmlToText } from "@/lib/jobs/normalize";
import { mapAdzuna, mapGreenhouse, mapJSearch, mapLever, mapRemotive } from "@/lib/jobs/map";

describe("normalize", () => {
  it("detects apply types", () => {
    expect(detectApplyType("https://boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
    expect(detectApplyType("https://jobs.lever.co/acme/abc")).toBe("lever");
    expect(detectApplyType("https://www.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(detectApplyType("https://www.naukri.com/job-listings-x")).toBe("portal");
    expect(detectApplyType("https://acme.com/careers/1")).toBe("unknown");
    expect(detectApplyType("not a url")).toBe("unknown");
  });
  it("dedupes across sources and company suffixes", () => {
    expect(dedupeKey("Acme Pvt. Ltd.", "Senior  Product Manager", "IN")).toBe(dedupeKey("ACME", "senior product manager!", "in"));
    expect(dedupeKey("Acme", "PM", "in")).not.toBe(dedupeKey("Acme", "PM", "us"));
  });
  it("strips escaped html", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;")).toBe("Hello & welcome\n- One");
  });
  it("guesses country", () => {
    expect(guessCountry("Bengaluru, India")).toBe("in");
    expect(guessCountry("Remote")).toBeUndefined();
  });
});

describe("mappers", () => {
  it("maps adzuna", () => {
    const j = mapAdzuna({ id: 9, title: "PM", company: { display_name: "Acme" }, location: { display_name: "Pune" }, redirect_url: "https://x", description: "d", salary_min: 1000000, salary_max: 1500000.4, created: "2026-10-01T00:00:00Z" }, "in");
    expect(j).toMatchObject({ source: "adzuna", externalId: "9", country: "in", salaryText: "1000000 - 1500000" });
  });
  it("maps jsearch with 2-letter country", () => {
    expect(mapJSearch({ job_id: "a", job_title: "PM", employer_name: "Acme", job_country: "IN", job_city: "Delhi", job_apply_link: "https://x", job_description: "d" }).country).toBe("in");
  });
  it("maps remotive, greenhouse and lever", () => {
    expect(mapRemotive({ id: 1, title: "t", company_name: "c", url: "u", description: "<p>x</p>", candidate_required_location: "Worldwide" }).description).toBe("x");
    expect(mapGreenhouse({ id: 2, title: "t", absolute_url: "u", location: { name: "Mumbai, India" }, content: "&lt;p&gt;y&lt;/p&gt;" }, "acme")).toMatchObject({ company: "acme", country: "in", description: "y" });
    expect(mapLever({ id: "z", text: "t", hostedUrl: "u", categories: { location: "Singapore" }, descriptionPlain: "p", createdAt: 1760000000000 }, "acme")).toMatchObject({ country: "sg", description: "p" });
  });
});
