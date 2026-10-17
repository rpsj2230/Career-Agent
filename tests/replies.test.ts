import { describe, expect, it } from "vitest";
import { classifyReply, matchApplication, nextLifecycle, type AppRef } from "@/lib/mail/replies";

const c = (subject: string, text = "") => classifyReply({ subject, text });

describe("classifyReply", () => {
  it("recognises interview invitations", () => {
    expect(c("Interview invitation: Product Manager", "Hi Asha, we would like to schedule a call this week.")).toBe("interview");
    expect(c("Next steps", "Please book a time here: https://calendly.com/recruiter/30min")).toBe("interview");
    expect(c("Re: your application", "Are you available on Thursday for a phone screen?")).toBe("interview");
  });
  it("recognises rejections", () => {
    expect(c("Your application to Acme", "Unfortunately, we have decided to move forward with other candidates.")).toBe("rejected");
    expect(c("Update on your application", "We regret to inform you that the position has been filled.")).toBe("rejected");
    expect(c("Application update", "You have not been successful on this occasion.")).toBe("rejected");
  });
  it("recognises offers", () => {
    expect(c("Offer of employment", "We are pleased to offer you the role of Senior Product Manager.")).toBe("offer");
  });
  it("ignores everything else, and a polite rejection that mentions future interviews is still a rejection", () => {
    expect(c("We received your application", "Thanks for applying. We will review it.")).toBeNull();
    expect(c("Weekly newsletter", "Ten tips for interviews")).toBeNull();
    expect(c("Your application", "Unfortunately we are not moving forward, but we may contact you about future roles.")).toBe("rejected");
  });
  it("a message that both rejects and schedules is left for you to read", () => {
    expect(c("Update", "Unfortunately not for this role, but we would like to schedule a call about another one.")).toBeNull();
  });
});

describe("matchApplication", () => {
  const apps: AppRef[] = [
    { id: "a1", company: "Acme Pte Ltd", submittedAt: "2026-09-01T00:00:00Z", lifecycle: "applied" },
    { id: "a2", company: "Acme Pte Ltd", submittedAt: "2026-10-05T00:00:00Z", lifecycle: "applied" },
    { id: "g1", company: "Globex Corporation", submittedAt: "2026-10-01T00:00:00Z", lifecycle: "none" },
    { id: "x", company: "AB", submittedAt: null, lifecycle: "none" },
  ];
  const mail = (o: Partial<{ from: string; subject: string; text: string; date: Date }>) => ({ from: "Recruiting <jobs@mail.example>", subject: "", text: "", ...o });
  it("finds the company by name in the sender, subject or opening text, in any spelling", () => {
    expect(matchApplication(mail({ from: "Acme Careers <hr@acme.com>" , date: new Date("2026-10-10")}), apps)?.id).toBe("a2");
    expect(matchApplication(mail({ subject: "Your application to GLOBEX" }), apps)?.id).toBe("g1");
    expect(matchApplication(mail({ text: "Thank you for applying to Globex Corporation." }), apps)?.id).toBe("g1");
  });
  it("with several applications to one company, the latest one before the message", () => {
    expect(matchApplication(mail({ subject: "Acme: update", date: new Date("2026-09-20") }), apps)?.id).toBe("a1");
    expect(matchApplication(mail({ subject: "Acme: update", date: new Date("2026-10-20") }), apps)?.id).toBe("a2");
  });
  it("never matches a short or unrelated name", () => {
    expect(matchApplication(mail({ subject: "AB news", text: "ab" }), apps)).toBeNull();
    expect(matchApplication(mail({ subject: "Hello", text: "Nothing relevant" }), apps)).toBeNull();
    expect(matchApplication(mail({ text: "We saw the acmeology course" }), apps)).toBeNull();
  });
});

describe("nextLifecycle", () => {
  it("moves forward and never backward", () => {
    expect(nextLifecycle("applied", "interview")).toBe("interview");
    expect(nextLifecycle("interview", "offer")).toBe("offer");
    expect(nextLifecycle("interview", "rejected")).toBe("rejected");
    expect(nextLifecycle("applied", "rejected")).toBe("rejected");
    expect(nextLifecycle("none", "interview")).toBe("interview");
  });
  it("an offer is never downgraded, withdrawals are yours, and repeats change nothing", () => {
    expect(nextLifecycle("offer", "rejected")).toBeNull();
    expect(nextLifecycle("offer", "interview")).toBeNull();
    expect(nextLifecycle("withdrawn", "interview")).toBeNull();
    expect(nextLifecycle("interview", "interview")).toBeNull();
    expect(nextLifecycle("rejected", "rejected")).toBeNull();
    expect(nextLifecycle("rejected", "interview")).toBeNull();
  });
});
