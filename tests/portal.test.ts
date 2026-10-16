import { describe, expect, it } from "vitest";
import { detectPortal, portalFromUrl, portalLabel, portalSlug } from "@/lib/jobs/portal";

describe("detectPortal", () => {
  it("prefers the publisher an aggregator reports, normalising spellings", () => {
    expect(detectPortal({ url: "https://acme.com/apply", publisher: "LinkedIn", integration: "jsearch:in:PM" })).toBe("linkedin");
    expect(detectPortal({ url: "https://x", publisher: "Naukri.com", integration: "jsearch:in:PM" })).toBe("naukri");
    expect(detectPortal({ url: "https://x", publisher: "Indeed India", integration: "jsearch" })).toBe("indeed");
    expect(detectPortal({ url: "https://x", publisher: "ZipRecruiter", integration: "jsearch" })).toBe("ziprecruiter");
  });
  it("uses the URL host when there is no publisher, and the integration as the last resort", () => {
    expect(detectPortal({ url: "https://in.indeed.com/viewjob?jk=1", integration: "manual" })).toBe("indeed");
    expect(detectPortal({ url: "https://boards.greenhouse.io/acme/jobs/1", integration: "greenhouse:acme" })).toBe("greenhouse");
    expect(detectPortal({ url: "https://acme.com/careers/1", integration: "adzuna:in:Product Manager" })).toBe("adzuna");
    expect(detectPortal({ url: "not a url", integration: "manual" })).toBe("manual");
  });
  it("does not mistake look-alike hosts", () => {
    expect(portalFromUrl("https://notlinkedin.example.com/x")).toBeNull();
    expect(portalFromUrl("https://evil.com/?u=linkedin.com")).toBeNull();
    expect(portalFromUrl("https://linkedin.com.evil.com/jobs/1")).toBeNull();
    expect(portalFromUrl("https://indeed.evil.com")).toBeNull();
    expect(portalFromUrl("https://uk.indeed.co.uk/viewjob")).toBe("indeed");
  });
  it("has readable labels", () => {
    expect(portalLabel("linkedin")).toBe("LinkedIn");
    expect(portalLabel("somenewsite")).toBe("Somenewsite");
    expect(portalLabel(null)).toBe("Unknown");
    expect(portalSlug("Naukri.com")).toBe("naukricom");
  });
});
