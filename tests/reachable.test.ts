import { describe, expect, it } from "vitest";
import { manualOnlyReason } from "../src/lib/apply/reachable";

describe("jobs the agent cannot apply for, so spends no resume on", () => {
  it("MyCareersFuture always needs you (Singpass)", () => {
    expect(manualOnlyReason({ url: "https://www.mycareersfuture.gov.sg/job/information-technology/x-123", portal: "mycareersfuture" }, { jsearchKey: true })).toMatch(/Singpass/);
    expect(manualOnlyReason({ url: "https://www.mycareersfuture.gov.sg/job/x", portal: null }, { jsearchKey: false })).toMatch(/Singpass/);
  });
  it("an Adzuna-style listing link has no route without a Google for Jobs key, and may have one with it", () => {
    for (const url of ["https://www.adzuna.com.au/details/5930326566?utm_medium=api", "https://www.adzuna.com/land/ad/5929934547", "https://www.jooble.org/desc/1", "https://www.careerjet.sg/jobad/x"]) {
      expect(manualOnlyReason({ url, portal: "adzuna" }, { jsearchKey: false }), url).toMatch(/JSearch/);
      expect(manualOnlyReason({ url, portal: "adzuna" }, { jsearchKey: true }), url).toBeNull();
    }
  });
  it("every other job is worked on", () => {
    for (const url of ["https://www.linkedin.com/jobs/view/4480419562", "https://boards.greenhouse.io/acme/jobs/1", "https://careers.acme.com/jobs/12", "https://sg.indeed.com/viewjob?jk=1", ""]) expect(manualOnlyReason({ url, portal: "linkedin" }, { jsearchKey: false }), url).toBeNull();
  });
});
