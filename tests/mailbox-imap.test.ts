import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { imapSource, scanMailbox } from "@/lib/jobs/mailbox";
import { startFakeImap } from "./e2e/fake-imap.mjs";

const h = (n: string) => readFileSync(`tests/fixtures/mail/${n}.html`, "utf8");
const day = (d: number) => new Date(Date.now() - d * 86_400_000);
let fake: Awaited<ReturnType<typeof startFakeImap>>;
const cfg = (o = {}) => ({ host: "127.0.0.1", port: fake.port, user: "me@example.com", password: "app-pass", ...o });

beforeAll(async () => {
  fake = await startFakeImap({ folders: {
    INBOX: [
      { uid: 1, from: "jobalert@naukri.com", subject: "Jobs for you", date: day(1), html: h("naukri") },
      { uid: 2, from: "alert@indeed.com", subject: "New Product Manager jobs", date: day(2), html: h("indeed") },
      { uid: 3, from: "friend@gmail.com", subject: "lunch?", date: day(1), html: "<p>hi</p>" },
      { uid: 4, from: "jobalerts-noreply@linkedin.com", subject: "PM in Singapore", date: day(3), html: h("linkedin") },
    ],
    "Job-alerts": [{ uid: 1, from: "noreply@glassdoor.com", subject: "New jobs", date: day(1), html: h("glassdoor") }],
  } });
});
afterAll(async () => { await fake.close(); });

describe("imapSource against a real IMAP conversation", () => {
  it("signs in, reads only portal-sender mail from the folder, and extracts the jobs", async () => {
    const r = await scanMailbox(imapSource(cfg()), { sinceDays: 30 });
    expect(r.emails).toBe(3); // the friend's message is never fetched
    expect(r.jobs.length).toBe(6);
    expect(r.byPortal).toEqual({ naukri: 2, indeed: 2, linkedin: 2 });
    expect(fake.state.fetched).not.toContain(3);
  });

  it("is read-only: opens the folder read-only, peeks at bodies, and never changes the mailbox", async () => {
    await scanMailbox(imapSource(cfg()), { sinceDays: 30 });
    expect(fake.state.selected.at(-1)).toEqual({ name: "INBOX", readOnly: true });
    expect(fake.state.mutations).toEqual([]);
    expect(fake.log.some((l: string) => /UID FETCH .*BODY\.PEEK\[\]/.test(l))).toBe(true);
    expect(fake.log.some((l: string) => /\bSTORE\b|\bEXPUNGE\b|\bMOVE\b|\bCOPY\b|\bDELETE\b/i.test(l))).toBe(false);
  });

  it("asks the server to filter by the portals' sender domains and by date", async () => {
    await scanMailbox(imapSource(cfg()), { sinceDays: 7 });
    const q = fake.state.searches.at(-1) as string;
    for (const d of ["linkedin.com", "indeed.com", "glassdoor.com", "naukri.com"]) expect(q).toContain(d);
    expect(q).toMatch(/SINCE \d{2}-[A-Z][a-z]{2}-\d{4}/);
  });

  it("reads another folder when one is configured", async () => {
    const r = await scanMailbox(imapSource(cfg({ folder: "Job-alerts" })), { sinceDays: 30 });
    expect(r.jobs.map((j) => j.title)).toEqual(["Product Manager"]);
    expect(r.byPortal).toEqual({ glassdoor: 1 });
  });

  it("limits how many messages are fetched", async () => {
    fake.state.fetched.length = 0;
    const r = await scanMailbox(imapSource(cfg()), { sinceDays: 30, max: 1 });
    expect(r.emails).toBe(1);
    expect(fake.state.fetched).toEqual([4]); // the newest message
  });

  it("explains a wrong password in plain words", async () => {
    await expect(scanMailbox(imapSource(cfg({ password: "nope" })), { sinceDays: 30 })).rejects.toThrow(/rejected the sign-in for me@example.com.*app password/);
  });

  it("explains a missing folder", async () => {
    await expect(scanMailbox(imapSource(cfg({ folder: "Nope" })), { sinceDays: 30 })).rejects.toThrow(/folder was not found/);
  });

  it("explains an unreachable server", async () => {
    await expect(scanMailbox(imapSource({ host: "127.0.0.1", port: 1, user: "a", password: "b" }), { sinceDays: 30 })).rejects.toThrow(/Could not connect to 127.0.0.1/);
  });
});
