import { describe, expect, it } from "vitest";
import { CONFIRMATION, detectBlock, matchAnswer, splitName, standardValue } from "../worker/match";

const bank = [
  { question: "Notice period", answer: "60 days" },
  { question: "Expected CTC", answer: "32 LPA" },
  { question: "Are you willing to relocate?", answer: "Yes" },
  { question: "Are you legally authorised to work in Singapore?", answer: "Yes, with an Employment Pass" },
  { question: "Blank", answer: "" },
];
const me = { name: "Asha Rao Nair", email: "a@x.com", phone: "+91 90000 00000", location: "Bengaluru", links: ["https://linkedin.com/in/asha", "https://asha.dev"] };

describe("matchAnswer", () => {
  it("matches by question family despite different wording", () => {
    expect(matchAnswer("How soon can you join? (notice period)", bank)).toBe("60 days");
    expect(matchAnswer("What is your salary expectation?", bank)).toBe("32 LPA");
  });
  it("never answers a sponsorship question from a work-authorisation answer (they mean opposite things)", () => {
    expect(matchAnswer("Do you require visa sponsorship?", bank)).toBeNull();
    expect(matchAnswer("Will you now or in the future require sponsorship?", bank)).toBeNull();
    const withSponsor = [...bank, { question: "Will you require visa sponsorship?", answer: "Yes" }];
    expect(matchAnswer("Do you require sponsorship to work here?", withSponsor)).toBe("Yes");
  });
  it("reuses an authorisation answer only for the country it was written for", () => {
    expect(matchAnswer("Are you legally authorised to work in Singapore?", bank)).toBe("Yes, with an Employment Pass");
    expect(matchAnswer("Are you authorised to work in India?", bank)).toBeNull();
    expect(matchAnswer("Do you have the right to work in the United Kingdom?", bank)).toBeNull();
    expect(matchAnswer("Are you eligible to work in this country?", bank)).toBe("Yes, with an Employment Pass");
  });
  it("matches by word overlap and refuses weak matches", () => {
    expect(matchAnswer("Are you willing to relocate?", bank)).toBe("Yes");
    expect(matchAnswer("Describe your favourite programming language", bank)).toBeNull();
    expect(matchAnswer("Blank", bank)).toBeNull();
  });
});

describe("CONFIRMATION recognises real confirmation pages", () => {
  it.each(["Thank you for applying!", "Thanks for applying to Acme", "Your application has been submitted.", "Application submitted!", "We have received your application", "We've received your application and will be in touch", "You've successfully applied", "Application received", "Your application was successfully submitted"])("%s", (t) => expect(CONFIRMATION.test(t)).toBe(true));
  it.each(["Apply for this job", "Submit your application below", "Please submit the form", "Applications close on Friday"])("not: %s", (t) => expect(CONFIRMATION.test(t)).toBe(false));
});

describe("standardValue / splitName", () => {
  it("fills identity fields", () => {
    expect(splitName("Asha Rao Nair")).toEqual({ first: "Asha", last: "Rao Nair" });
    expect(standardValue("First Name *", me)).toBe("Asha");
    expect(standardValue("Last name", me)).toBe("Rao Nair");
    expect(standardValue("Email address", me)).toBe("a@x.com");
    expect(standardValue("Mobile number", me)).toBe("+91 90000 00000");
    expect(standardValue("LinkedIn profile", me)).toBe("https://linkedin.com/in/asha");
    expect(standardValue("Portfolio / website", me)).toBe("https://asha.dev");
    expect(standardValue("Favourite colour", me)).toBeNull();
  });
  it("does not put identity data into look-alike questions", () => {
    expect(standardValue("Name your favourite sorting algorithm *", me)).toBeNull();
    expect(standardValue("Name your favourite sorting algorithm q9", me)).toBeNull();
    expect(standardValue("Full name *", me)).toBe("Asha Rao Nair");
    expect(standardValue("Name", me)).toBe("Asha Rao Nair");
    expect(standardValue("Are you open to relocation?", me)).toBeNull();
    expect(standardValue("Current location", me)).toBe("Bengaluru");
    expect(standardValue("Describe your curl experience", me)).toBeNull();
    expect(standardValue("Is your employer aware?", me)).toBeNull();
  });
});

describe("detectBlock / CONFIRMATION", () => {
  it("never tries to pass checkpoints or captchas", () => {
    expect(detectBlock("https://www.linkedin.com/checkpoint/challenge", "", false)).toBe("checkpoint");
    expect(detectBlock("https://x.com/apply", "We noticed unusual activity", false)).toBe("checkpoint");
    expect(detectBlock("https://x.com/apply", "", true)).toBe("captcha");
    expect(detectBlock("https://x.com/login", "", false)).toBe("login");
    expect(detectBlock("https://x.com/apply", "Apply now", false)).toBeNull();
  });
  it("recognises confirmation text", () => {
    expect(CONFIRMATION.test("Thank you for applying!")).toBe(true);
    expect(CONFIRMATION.test("Your application has been submitted")).toBe(true);
    expect(CONFIRMATION.test("Please fill in the form")).toBe(false);
  });
});
