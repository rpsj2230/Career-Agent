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
    expect(matchAnswer("Do you require visa sponsorship?", bank)).toBe("Yes, with an Employment Pass");
  });
  it("matches by word overlap and refuses weak matches", () => {
    expect(matchAnswer("Are you willing to relocate?", bank)).toBe("Yes");
    expect(matchAnswer("Describe your favourite programming language", bank)).toBeNull();
    expect(matchAnswer("Blank", bank)).toBeNull();
  });
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
