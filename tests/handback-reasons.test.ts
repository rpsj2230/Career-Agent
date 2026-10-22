import { describe, expect, it } from "vitest";
import { classifyHandback, groupHandbacks } from "@/lib/handback-reasons";

describe("classifyHandback", () => {
  it("recognises each message the workers write", () => {
    expect(classifyHandback("The link stays on the job board (its Apply link did not lead to the employer's own page); apply on the employer's own site")).toBe("job_board");
    expect(classifyHandback("The link opens a job board's listing or search page, not an application form; apply on the employer's own site")).toBe("job_board");
    expect(classifyHandback("No application form was found on this page (it may need a sign-in, or the role may be closed); apply on the employer's site")).toBe("no_form");
    expect(classifyHandback("The page shows a CAPTCHA; please do this one yourself")).toBe("captcha");
    expect(classifyHandback("The portal shows a security check; automatic applying was stopped for safety")).toBe("captcha");
    expect(classifyHandback("The portal asked for a sign-in: open the assistant once without hands-free mode and sign in")).toBe("sign_in");
    expect(classifyHandback("Needs you: I consent to the use of my information (locator.check: Timeout 30000ms exceeded.)")).toBe("question");
    expect(classifyHandback("Could not find the submit button")).toBe("submit");
    expect(classifyHandback("Pressed submit, but no confirmation message was detected; check your email or the portal before retrying")).toBe("submit");
    expect(classifyHandback("Could not reach the final step of the form")).toBe("submit");
    expect(classifyHandback("The assistant could not finish this one (boom)")).toBe("other");
    expect(classifyHandback(null)).toBe("other");
  });
});

describe("groupHandbacks", () => {
  it("counts per reason, biggest first, with the sites behind each", () => {
    const board = "The link stays on the job board (its Apply link did not lead to the employer's own page)";
    const lines = groupHandbacks([
      { error: board, portal: "adzuna" }, { error: board, portal: "adzuna" }, { error: board, portal: "jooble" },
      { error: "No application form was found on this page", portal: "mycareersfuture" },
      { error: "The page shows a CAPTCHA; please do this one yourself", portal: null },
    ], (p) => p.toUpperCase());
    expect(lines.map((l) => [l.id, l.count])).toEqual([["job_board", 3], ["no_form", 1], ["captcha", 1]]);
    expect(lines[0].portals).toEqual([{ portal: "ADZUNA", count: 2 }, { portal: "JOOBLE", count: 1 }]);
    expect(lines[2].portals).toEqual([{ portal: "Unknown site", count: 1 }]);
    expect(lines[0].action).toMatch(/employer/);
  });
  it("is empty when nothing was handed back", () => { expect(groupHandbacks([])).toEqual([]); });
});
