import { describe, expect, it, vi } from "vitest";
import { contactEmailsFor, extractContactEmails, mailtoAddress } from "@/lib/apply/contact-email";
import { applyRoute, emailModeFor, nextStep } from "@/lib/apply/route";
import { sendEmail } from "@/lib/email";
import { detectApplyType } from "@/lib/jobs/normalize";
import { assessCover } from "@/lib/tailor/quality";
import { writeApplicationEmail } from "@/lib/tailor/email-draft";
import { writeCoverLetter, type Runner } from "@/lib/tailor/tailor";
import { MasterProfile } from "@/lib/types";

vi.mock("server-only", () => ({}));

describe("finding contact addresses in a posting", () => {
  it("prefers hiring addresses at the company and ignores no-reply, job-site and image addresses", () => {
    const text = "Apply on our site or email Jobs@Acme.com. Do not use noreply@acme.com. Logo logo@2x.png. Via adzuna: alerts@adzuna.com. Questions: info@acme.com";
    const r = extractContactEmails(text, "Acme Pte Ltd");
    expect(r.map((x) => x.email)).toEqual(["jobs@acme.com", "info@acme.com"]);
    expect(r[0].why).toMatch(/hiring address/);
  });
  it("reads addresses written to dodge bots", () => {
    expect(extractContactEmails("send your CV to careers [at] northwind [dot] io", "Northwind").map((x) => x.email)).toEqual(["careers@northwind.io"]);
  });
  it("gives the apply link first when it is a mailto: link", () => {
    expect(mailtoAddress("mailto:hr@x.com?subject=Hi")).toBe("hr@x.com");
    expect(mailtoAddress("https://x.com")).toBeNull();
    expect(detectApplyType("mailto:hr@x.com")).toBe("email");
    const all = contactEmailsFor({ url: "mailto:hr@x.com", description: "also talent@x.com", company: "X" });
    expect(all[0]).toMatchObject({ email: "hr@x.com", score: 99 });
    expect(all.map((a) => a.email)).toEqual(["hr@x.com", "talent@x.com"]);
  });
  it("finds nothing when there is no address", () => { expect(extractContactEmails("No contact details here.")).toEqual([]); });
});

describe("how an emailed application relates to the normal route", () => {
  it("is the application itself for email-only and unknown sites, and an addition for ATS, LinkedIn and portals", () => {
    expect(emailModeFor({ apply_type: "email" }, true)).toBe("only");
    expect(emailModeFor({ apply_type: "unknown", url: "https://careers.x.com/1" }, true)).toBe("only");
    expect(emailModeFor({ apply_type: "greenhouse", url: "https://boards.greenhouse.io/x/jobs/1" }, true)).toBe("also");
    expect(emailModeFor({ apply_type: "linkedin" }, true)).toBe("also");
    expect(emailModeFor({ apply_type: "unknown" }, false)).toBeNull();
  });
  it("labels the route and tells you what to do", () => {
    const only = applyRoute({ apply_type: "unknown", emailMode: "only" });
    expect(only.kind).toBe("email");
    expect(applyRoute({ apply_type: "greenhouse", emailMode: "also" }).label).toMatch(/\+ email/);
    expect(nextStep("prepared", only, "a").text).toMatch(/email/i);
  });
});

describe("sending with attachments", () => {
  it("passes the files, the display name and the reply-to address to the mail server", async () => {
    const sent: Record<string, unknown>[] = [];
    const err = await sendEmail({ host: "h", port: 465, user: "me@x.com", password: "p" }, { to: "hr@acme.com", subject: "Application", text: "Hi", attachments: [{ filename: "Resume.docx", content: Buffer.from("x") }], fromName: 'Asha "Rao"\r\n', replyTo: "asha@x.com" }, () => ({ sendMail: async (o) => { sent.push(o); } }));
    expect(err).toBeNull();
    expect(sent[0]).toMatchObject({ to: "hr@acme.com", replyTo: "asha@x.com" });
    expect(sent[0].from).toBe("Asha Rao <me@x.com>");
    expect((sent[0].attachments as unknown[]).length).toBe(1);
  });
});

const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "a@x.com", headline: "Product Manager", summary: "Product manager with six years of experience in payments." },
  preferences: { countries: ["in"], roles: [] },
  experience: [{ id: "exp1", company: "Acme", title: "Product Manager", start: "2020", end: "Present", bullets: [{ id: "exp1.b1", text: "Grew checkout activation by 24% using SQL funnel analysis and A/B testing" }, { id: "exp1.b2", text: "Managed the payments roadmap with engineering and design" }] }],
  skills: [{ id: "skill1", name: "SQL" }, { id: "skill2", name: "Roadmapping" }],
});
const job = { title: "Senior Product Manager, Payments", company: "Beta", description: "We need a product manager to own the payments roadmap, run A/B testing and SQL funnel analysis to improve checkout activation. ".repeat(3) };

describe("explaining the fit", () => {
  const weak = "Dear hiring team, I would like to apply for this role. Kind regards";
  const strong = "Dear Hiring Manager,\n\nI am applying for the Product Manager, Payments role at Beta. I grew checkout activation by 24% using SQL funnel analysis and A/B testing, which is exactly what your payments roadmap needs.\n\nI also managed the payments roadmap with engineering and design, so I can own it from day one. My resume and cover letter are attached, and I would welcome a conversation about the role.\n\nKind regards,\nAsha Rao";
  it("scores a vague note low and says what to fix, and a note that ties experience to the job high", () => {
    const w = assessCover(profile, weak, job), s = assessCover(profile, strong, job, { kind: "email", maxWords: 230 });
    expect(w.problems.length).toBeGreaterThanOrEqual(3);
    expect(s.problems).toEqual([]);
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(w.score).toBeLessThan(40);
  });
  it("tells the cover-letter writer that its purpose is to show why the candidate fits, and asks again when it does not", async () => {
    const systems: string[] = [], prompts: string[] = [];
    const run: Runner = async (o) => { systems.push(o.system); prompts.push(o.prompt); return { output: { text: prompts.length === 1 ? weak : strong, sourceIds: ["exp1.b1"] } as never, model: "m" }; };
    const r = await writeCoverLetter(profile, job, run);
    expect(systems[0]).toMatch(/WHY THIS CANDIDATE IS A STRONG FIT/);
    expect(prompts[1]).toMatch(/DOES NOT SHOW WHY THE CANDIDATE FITS/);
    expect(r.content.text).toBe(strong);
  });
  it("writes the application email the same way: a subject, a body that explains the fit, and the attachments mentioned", async () => {
    const calls: string[] = [];
    const run: Runner = async (o) => { calls.push(o.system); return { output: { subject: "Application: Product Manager, Payments - Asha Rao", body: strong, sourceIds: ["exp1.b1", "exp1.b2"] } as never, model: "m" }; };
    const r = await writeApplicationEmail(profile, job, run);
    expect(calls[0]).toMatch(/application email that carries/);
    expect(calls[0]).toMatch(/WHY THIS CANDIDATE IS A STRONG FIT/);
    expect(r.verification.ok).toBe(true);
    expect(r.content.subject).toMatch(/Asha Rao/);
    expect(r.quality.problems).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it("asks again when the email does not mention the attachments", async () => {
    const bodyNoAttach = strong.replace("My resume and cover letter are attached, and I", "I");
    const prompts: string[] = [];
    const run: Runner = async (o) => { prompts.push(o.prompt); return { output: { subject: "Application: Product Manager - Asha Rao", body: prompts.length === 1 ? bodyNoAttach : strong, sourceIds: ["exp1.b1"] } as never, model: "m" }; };
    const r = await writeApplicationEmail(profile, job, run);
    expect(prompts[1]).toMatch(/attached/);
    expect(r.content.body).toBe(strong);
  });
  it("flags an email that invents a number", async () => {
    const r = await writeApplicationEmail(profile, job, async () => ({ output: { subject: "Application: PM - Asha Rao", body: strong.replace("24%", "90%"), sourceIds: ["exp1.b1"] } as never, model: "m" }));
    expect(r.verification.ok).toBe(false);
  });
});

import { verifyCoverLetter } from "@/lib/docs/verify";
describe("greetings and sign-offs", () => {
  it("do not count as invented names, but invented employers still do", () => {
    const ok = verifyCoverLetter(profile, { text: "Dear Hiring Manager,\n\nI grew checkout activation by 24% using SQL funnel analysis and A/B testing.\n\nBest regards,\nAsha Rao", sourceIds: ["exp1.b1"] }, ["Beta", "Asha Rao"]);
    expect(ok.ok).toBe(true);
    const bad = verifyCoverLetter(profile, { text: "Dear Hiring Manager,\n\nAt Google I grew checkout activation by 24% using SQL funnel analysis.\n\nKind regards,\nAsha Rao", sourceIds: ["exp1.b1"] }, ["Beta", "Asha Rao"]);
    expect(bad.ok).toBe(false);
  });
});

import { explainError, modelHealth } from "@/lib/llm/health";
import { drainDecision, hoursToClear } from "@/lib/backlog-rules";

describe("is a model working?", () => {
  const call = (ok: boolean, error?: string, at = "2026-10-18T10:00:00Z") => ({ ok, error, at });
  const base = { enabled: true, keyed: true, todayOk: 0, todayBad: 0, dailyCap: 200 };
  it("says working when the latest call succeeded, even after failures", () => {
    expect(modelHealth({ ...base, calls: [call(true), call(false, "429"), call(false, "429")] })).toMatchObject({ status: "working" });
  });
  it("says not working, with the reason in plain words, when every recent call failed", () => {
    const h = modelHealth({ ...base, calls: [call(false, "HTTP 429 quota exceeded"), call(false, "429")] });
    expect(h.status).toBe("failing");
    expect(h.hint).toMatch(/free quota/);
    expect(modelHealth({ ...base, calls: [call(false, "401 invalid api key")] }).hint).toMatch(/rejected the key/);
    expect(modelHealth({ ...base, calls: [call(false, "model_decommissioned: not found")] }).hint).toMatch(/model name/);
  });
  it("says unstable when the latest failed but some recent ones worked", () => {
    expect(modelHealth({ ...base, calls: [call(false, "timeout"), call(true), call(true)] }).status).toBe("unstable");
  });
  it("handles no key, switched off, not used and a used-up daily allowance", () => {
    expect(modelHealth({ ...base, keyed: false, calls: [] }).status).toBe("no_key");
    expect(modelHealth({ ...base, enabled: false, calls: [] }).status).toBe("off");
    expect(modelHealth({ ...base, calls: [] }).status).toBe("unused");
    expect(modelHealth({ ...base, todayOk: 200, calls: [call(true)] }).status).toBe("limit");
    expect(explainError("")).toBe("");
  });
});

describe("working through a backlog by itself", () => {
  const base = { unscored: 100, unprepared: 0, modelsUsable: true, autoPrepare: true, preparingSchedule: true, state: null };
  it("runs when jobs wait and a model works, and not otherwise", () => {
    expect(drainDecision(base).drain).toBe(true);
    expect(drainDecision({ ...base, modelsUsable: false }).drain).toBe(false);
    expect(drainDecision({ ...base, unscored: 0 }).drain).toBe(false);
    expect(drainDecision({ ...base, unscored: 0, unprepared: 5 }).drain).toBe(true);
    expect(drainDecision({ ...base, unscored: 0, unprepared: 5, preparingSchedule: false }).drain).toBe(false);
    expect(drainDecision({ ...base, unscored: 0, unprepared: 5, autoPrepare: false }).drain).toBe(false);
  });
  it("pauses for hours after rounds that made no progress, then tries again", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(drainDecision({ ...base, state: { at: "2026-10-18T10:00:00Z", noProgress: 2 }, now }).drain).toBe(false);
    expect(drainDecision({ ...base, state: { at: "2026-10-18T04:00:00Z", noProgress: 2 }, now }).drain).toBe(true);
    expect(drainDecision({ ...base, state: { at: "2026-10-18T11:00:00Z", noProgress: 1 }, now }).drain).toBe(true);
  });
  it("estimates the hours to clear", () => { expect(hoursToClear(230, 20, 8)).toBe(4); expect(hoursToClear(0, 0)).toBe(0); });
});

import { sourceVerdict, summarizeScans } from "@/lib/source-performance";

describe("which job sources are worth it", () => {
  const base = { id: "x", name: "X", scans: 40, failedScans: 0, fetched: 400, inserted: 100, matched: 12, spanDays: 30 };
  it("calls a source that yields good matches productive", () => { expect(sourceVerdict(base)).toMatchObject({ tone: "good", reliable: true }); });
  it("flags sources that mostly fail, return nothing, find nothing new, or find many jobs that never fit", () => {
    expect(sourceVerdict({ ...base, failedScans: 30 })).toMatchObject({ tone: "bad", headline: "Mostly failing" });
    expect(sourceVerdict({ ...base, fetched: 0, inserted: 0, matched: 0 })).toMatchObject({ tone: "bad", headline: "Returns nothing for you" });
    expect(sourceVerdict({ ...base, inserted: 0, matched: 0 })).toMatchObject({ tone: "bad", headline: "Nothing new" });
    expect(sourceVerdict({ ...base, inserted: 200, matched: 2 })).toMatchObject({ tone: "bad", headline: "Many jobs, few fits" });
  });
  it("labels the numbers early until about a month of runs", () => {
    const v = sourceVerdict({ ...base, spanDays: 6, scans: 6, fetched: 0, inserted: 0, matched: 0 });
    expect(v.reliable).toBe(false);
    expect(v.advice).toMatch(/early numbers/);
    expect(v.tone).toBe("early");
  });
  it("counts scans, new jobs and matches per source from the stored records", () => {
    const rows = summarizeScans(
      [{ integration: "adzuna", status: "ok", fetched: 10, inserted: 4, started_at: "2026-09-01T00:00:00Z" }, { integration: "adzuna", status: "error", fetched: 0, inserted: 0, started_at: "2026-10-01T00:00:00Z" }],
      [{ source: "adzuna:1", status: "queued" }, { source: "adzuna:2", status: "skipped" }, { source: "mailbox:x", status: "applied" }],
      { adzuna: "Adzuna" }, new Date("2026-10-18T00:00:00Z"),
    );
    const a = rows.find((r) => r.id === "adzuna")!;
    expect(a).toMatchObject({ name: "Adzuna", scans: 2, failedScans: 1, fetched: 10, inserted: 4, matched: 1, spanDays: 47 });
    expect(rows.find((r) => r.id === "mailbox")?.matched).toBe(1);
  });
});
