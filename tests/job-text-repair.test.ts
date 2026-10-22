import { describe, expect, it } from "vitest";
import { contextOf, parseAlertEmail } from "@/lib/jobs/email-parse";
import { decodeEntities, htmlToText, plainField } from "@/lib/jobs/normalize";
import { looksGarbled, repairJobText } from "@/lib/jobs/repair";

describe("entities and cut-off tags", () => {
  it("decodes the character references emails use", () => {
    expect(decodeEntities("Resaro &middot; Singapore &amp; more &#183; &#x2F; &nbsp;x &bogus;")).toBe("Resaro · Singapore & more · /  x &bogus;");
    expect(plainField("FDE Times &middot; Singapore")).toBe("FDE Times · Singapore");
  });
  it("drops a tag that was cut off in the middle", () => {
    expect(plainField('Singapore <td class="pt-3" data-test-id="job-card" s')).toBe("Singapore");
    expect(plainField('<td class="pt-3" data-test-id="job-c')).toBe("");
    expect(htmlToText("<p>Hello &amp; welcome</p>")).toBe("Hello & welcome");
  });
});

describe("the LinkedIn alert that produced HTML in the place column", () => {
  const html = `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4000001?trk=x">Forward Deployed Strategist</a></td></tr>
    <tr><td class="pt-3" data-test-id="job-card-company">Resaro &middot; Singapore (Hybrid)</td></tr></table>`;
  it("reads the company and the place from one line", () => {
    const [job] = parseAlertEmail({ from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "New jobs", html });
    expect(job.company).toBe("Resaro");
    expect(job.location).toBe("Singapore (Hybrid)");
    expect(job.country).toBe("sg");
  });
  it("never keeps a cut-off tag when the text after the title is sliced", () => {
    const long = `<a href="https://www.linkedin.com/comm/jobs/view/4000002">Strategist</a>` + "<div>FDE Times &middot; Singapore</div>" + "x".repeat(1600) + '<td class="pt-3" data-test-id="job-card" style="padding:0">';
    const [job] = parseAlertEmail({ from: "jobalerts-noreply@linkedin.com", subject: "s", html: long });
    expect(job.company).toBe("FDE Times");
    expect(job.location).toBe("Singapore");
    expect(`${job.company}${job.location}`).not.toMatch(/[<>]/);
  });
  it("contextOf splits on a decoded middle dot", () => {
    expect(contextOf("Resaro · Singapore (Hybrid)")).toMatchObject({ company: "Resaro", location: "Singapore (Hybrid)" });
  });
});

describe("repairJobText (jobs saved by the older reader)", () => {
  it("spots garbled text", () => {
    expect(looksGarbled('<td class="pt-3" data-test-id="job-c')).toBe(true);
    expect(looksGarbled("Resaro &middot; Singapore")).toBe(true);
    expect(looksGarbled("Sydney, NSW")).toBe(false);
    expect(looksGarbled(null)).toBe(false);
  });
  it("splits a company that carries its place, and empties a place that was only HTML", () => {
    expect(repairJobText({ company: "Resaro &middot; Singapore (Hybrid)", location: '<td class="pt-3" data-test-id="job-c' })).toEqual({ company: "Resaro", location: "Singapore (Hybrid)" });
    expect(repairJobText({ company: "Shopee &middot; Singapore (On-site)", location: null })).toEqual({ company: "Shopee", location: "Singapore (On-site)" });
    expect(repairJobText({ company: "Acme", location: '<td class="job-card-' })).toEqual({ company: "Acme", location: null });
  });
  it("leaves clean jobs alone", () => {
    expect(repairJobText({ company: "Acme", location: "Pune" })).toBeNull();
  });
});
