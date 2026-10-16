import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAlertSender, parseAlertEmail, senderPortal } from "@/lib/jobs/email-parse";

const html = (n: string) => readFileSync(`tests/fixtures/mail/${n}.html`, "utf8");
const date = new Date("2026-10-15T08:00:00Z");

describe("sender detection", () => {
  it("recognises the four portals' own domains only", () => {
    expect(senderPortal("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>")?.portal).toBe("linkedin");
    expect(senderPortal("alert@indeed.com")?.portal).toBe("indeed");
    expect(senderPortal("noreply@glassdoor.com")?.portal).toBe("glassdoor");
    expect(senderPortal("Naukri <jobalert@naukri.com>")?.portal).toBe("naukri");
    expect(isAlertSender("promo@linkedin.com.evil.example")).toBe(false);
    expect(isAlertSender("friend@gmail.com")).toBe(false);
  });
});

describe("LinkedIn alerts", () => {
  const jobs = parseAlertEmail({ from: "jobalerts-noreply@linkedin.com", subject: "Product Manager in Singapore: new jobs", html: html("linkedin"), date });
  it("finds each job once, using the title link and ignoring 'View job', search and unsubscribe links", () => {
    expect(jobs.map((j) => j.title)).toEqual(["Senior Product Manager", "Product Manager, Payments"]);
  });
  it("builds a clean canonical URL without tracking parameters", () => {
    expect(jobs[0].url).toBe("https://www.linkedin.com/jobs/view/3912345678");
    expect(jobs[0].externalId).toBe("linkedin-3912345678");
  });
  it("reads company and location from the text after the title", () => {
    expect(jobs[0]).toMatchObject({ company: "Acme Pte Ltd", location: "Singapore, Singapore", country: "sg", publisher: "linkedin", source: "mailbox" });
    expect(jobs[1]).toMatchObject({ company: "Beta Corp", location: "Singapore" });
  });
  it("does not accept a look-alike link from another site", () => {
    expect(jobs.some((j) => j.title.includes("Phishing"))).toBe(false);
  });
  it("is honest that only a summary was available", () => {
    expect(jobs[0].description).toMatch(/Only this summary was in the email/);
    expect(jobs[0].postedAt).toBe(date.toISOString());
  });
});

describe("Indeed alerts", () => {
  const jobs = parseAlertEmail({ from: "alert@indeed.com", subject: "New Product Manager jobs", html: html("indeed"), date });
  it("extracts jobs from tracking links using the job key", () => {
    expect(jobs.map((j) => [j.title, j.externalId])).toEqual([["Product Manager", "indeed-0123456789abcdef"], ["Program Manager", "indeed-fedcba9876543210"]]);
    expect(jobs[0].url).toBe("https://www.indeed.com/viewjob?jk=0123456789abcdef");
  });
  it("splits 'Company - Location', keeps the pay text, and infers the country from a city", () => {
    expect(jobs[0]).toMatchObject({ company: "Gamma Technologies", location: "Bengaluru, Karnataka", country: "in" });
    expect(jobs[1]).toMatchObject({ company: "Delta Systems", location: "Remote" });
    expect(jobs[0].salaryText).toMatch(/24,00,000/);
  });
});

describe("Naukri alerts", () => {
  const jobs = parseAlertEmail({ from: "jobalert@naukri.com", subject: "Jobs for you", html: html("naukri"), date });
  it("extracts listings with their numeric id and a clean URL", () => {
    expect(jobs.map((j) => j.externalId)).toEqual(["naukri-150124500123", "naukri-150124500456"]);
    expect(jobs[0].url).toBe("https://www.naukri.com/job-listings-product-manager-zeta-solutions-bengaluru-5-to-9-years-150124500123");
  });
  it("reads company, city (so the country) and pay", () => {
    expect(jobs[0]).toMatchObject({ company: "Zeta Solutions Pvt Ltd", location: "Bengaluru", country: "in" });
    expect(jobs[0].salaryText).toMatch(/18-28 Lacs/);
    expect(jobs[1]).toMatchObject({ company: "Eta Labs", location: "Mumbai", country: "in" });
  });
});

describe("Glassdoor alerts", () => {
  it("extracts the listing and its country", () => {
    const [j] = parseAlertEmail({ from: "noreply@glassdoor.com", subject: "New jobs", html: html("glassdoor"), date });
    expect(j).toMatchObject({ title: "Product Manager", company: "Theta Inc", country: "gb", externalId: "glassdoor-1009123456789" });
  });
});

describe("safety", () => {
  it("ignores mail from unknown senders even if it contains portal links", () => {
    expect(parseAlertEmail({ from: "someone@gmail.com", subject: "fwd", html: html("linkedin"), date })).toEqual([]);
  });
  it("ignores a portal's mail whose links point at a different site", () => {
    expect(parseAlertEmail({ from: "alert@indeed.com", subject: "x", html: html("linkedin"), date })).toEqual([]);
  });
  it("returns nothing for an empty or link-free message", () => {
    expect(parseAlertEmail({ from: "alert@indeed.com", subject: "x", html: "", date })).toEqual([]);
    expect(parseAlertEmail({ from: "alert@indeed.com", subject: "x", html: "<p>No jobs today</p>", date })).toEqual([]);
  });
  it("does not blow up on malformed HTML and hostile hrefs", () => {
    expect(() => parseAlertEmail({ from: "jobalerts-noreply@linkedin.com", subject: "x", html: '<a href="javascript:alert(1)">Role</a><a href="::::">x</a><a href="https://www.linkedin.com/jobs/view/12345678"', date })).not.toThrow();
  });
});
