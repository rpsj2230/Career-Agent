import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext } from "playwright";
import { buildFillData } from "../src/lib/apply/fill-data";
import { makeToken } from "../src/lib/extension/link";
import { MasterProfile } from "../src/lib/types";

/**
 * Automatic mode, in the real extension in a real Chromium, against a stand-in for the app and for employers' forms: it takes each waiting application, fills it,
 * attaches its resume, presses Next and Submit, reads the employer's confirmation and closes the tab, and gives back, with the reason, every application that
 * needs a person (an unanswered required question, a captcha, a page that does not name the company) or whose Submit was not confirmed.
 * The browser's own "allow all sites" question cannot be answered by a test, so the test copy of the manifest grants those sites up front.
 */
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
const live = it.skipIf(!executablePath);

const TOKEN = makeToken("legacy");
const id = (n: number) => `aaaaaaaa-bbbb-cccc-dddd-${String(n).padStart(12, "0")}`;
const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8716 1454", location: "Singapore", links: [] },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Ran training workshops" }] }],
  preferences: { countries: [], roles: [], noticePeriod: "60 days" },
});

type Event = { applicationId: string; action: string; note?: string; confirmation?: string };
const server$ = { events: [] as Event[], allowed: true, refuseClaim: false, queue: [] as Record<string, unknown>[], submittedPages: [] as string[] };
let server: Server, base = "", ctx: BrowserContext | undefined, extDir = "";

const FIELDS = `<label for="n">Full name*</label><input id="n" required>
  <label for="e">Email*</label><input id="e" type="email" required>`;
const THANKS = `document.body.innerHTML = '<h1>Thank you for applying to Acme</h1><p>Your application has been received.</p>'; window.name = 'sent';`;
const PAGES: Record<string, string> = {
  single: `<h2>Acme careers: Head of Ops</h2><form id="f">${FIELDS}<label for="np">Notice period*</label><input id="np" required><label for="r">Resume/CV*</label><input type="file" id="r" required><button type="submit">Submit application</button></form>
    <script>f.onsubmit = (ev) => { ev.preventDefault(); const name = document.getElementById('r').files[0].name; fetch('/sent?file=' + encodeURIComponent(name)); ${THANKS} };</script>`,
  steps: `<h2>Acme careers: Programme Lead</h2><form id="f"><div id="s1">${FIELDS}<button type="button" id="nx">Next</button></div>
    <div id="s2" style="display:none"><label for="np">Notice period*</label><input id="np" required><label for="r">Resume/CV*</label><input type="file" id="r" required><button type="submit">Submit</button></div></form>
    <script>nx.onclick = () => { if (!n.checkValidity() || !e.checkValidity()) return; s1.style.display = 'none'; s2.style.display = 'block'; };
    f.onsubmit = (ev) => { ev.preventDefault(); fetch('/sent?file=steps'); ${THANKS} };</script>`,
  question: `<h2>Acme careers: Analyst</h2><form id="f">${FIELDS}<label for="ls">Describe your leadership style*</label><textarea id="ls" required></textarea><button type="submit">Submit application</button></form>
    <script>f.onsubmit = (ev) => { ev.preventDefault(); fetch('/sent?file=question'); ${THANKS} };</script>`,
  captcha: `<h2>Acme careers: Designer</h2><form id="f">${FIELDS}<div class="g-recaptcha" data-sitekey="k" style="width:300px;height:80px">captcha</div><button type="submit">Submit application</button></form>
    <script>f.onsubmit = (ev) => { ev.preventDefault(); fetch('/sent?file=captcha'); ${THANKS} };</script>`,
  silent: `<h2>Acme careers: Engineer</h2><form id="f">${FIELDS}<button type="submit">Submit application</button></form><script>f.onsubmit = (ev) => { ev.preventDefault(); fetch('/sent?file=silent'); };</script>`,
};

const item = (n: number, page: string, over: Record<string, unknown> = {}) => ({ id: id(n), status: "failed", company: "Acme", title: `Role ${n}`, formUrl: `${base}/form/${page}`, note: "The assistant could not finish it", resume: { name: `Resume-${n}.docx` }, cover: null, ...over });

function handler(req: IncomingMessage, res: ServerResponse) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url ?? "/", base);
  if (url.pathname.startsWith("/form/")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<!doctype html><html><head><title>Apply</title></head><body>${PAGES[url.pathname.slice(6)] ?? ""}</body></html>`); }
  if (url.pathname === "/sent") { server$.submittedPages.push(url.searchParams.get("file") ?? ""); res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith("/api/extension/")) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401, { ...cors, "Content-Type": "application/json" }); return res.end('{"error":"not valid"}'); }
  }
  if (url.pathname === "/api/extension/data") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ...buildFillData(profile, [{ question: "What is your notice period?", answer: "60 days" }]), queue: server$.queue, autoSubmit: server$.allowed ? { allowed: true, remainingToday: 10, why: null } : { allowed: false, remainingToday: 0, why: "Auto-Apply is switched off in Career Agent (Settings)." }, latestExtensionVersion: "1.3.0" }));
  }
  if (url.pathname === "/api/extension/file") { res.writeHead(200, { ...cors, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }); return res.end(Buffer.from("TAILORED RESUME")); }
  if (url.pathname === "/api/extension/mark" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const b = JSON.parse(body) as Event;
      server$.events.push(b);
      if (b.action === "claim" && (!server$.allowed || server$.refuseClaim)) { res.writeHead(409, { ...cors, "Content-Type": "application/json" }); return res.end('{"error":"Auto-Apply is switched off","global":true}'); }
      if (b.action === "submitted") server$.queue = server$.queue.filter((q) => q.id !== b.applicationId);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end("{}");
    });
    return;
  }
  res.writeHead(404, cors); res.end();
}

beforeAll(async () => {
  if (!executablePath) return;
  execFileSync("node", ["scripts/build-extension.mjs"], { stdio: "ignore" });
  extDir = mkdtempSync(join(tmpdir(), "ca-ext-auto-"));
  cpSync("extension/dist", extDir, { recursive: true });
  const m = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ ...m, host_permissions: ["http://127.0.0.1/*"] }));
  await new Promise<void>((ok) => { server = createServer(handler).listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); });
  try {
    ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ca-prof-auto-")), { executablePath, headless: false, args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-sandbox"] });
  } catch { ctx = undefined; }
}, 60_000);
afterAll(async () => { await ctx?.close(); server?.close(); });

async function popupPage() {
  expect(ctx, "the browser with the extension must start").toBeDefined();
  const sw = ctx!.serviceWorkers()[0] ?? (await ctx!.waitForEvent("serviceworker", { timeout: 15_000 }));
  const popup = await ctx!.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token }, settings: {}, tried: {} }), [base, TOKEN]);
  return popup;
}
const by = (action: string) => server$.events.filter((e) => e.action === action);

describe("automatic mode in the real extension", () => {
  live("sends what it can, gives back the rest with the reason, and closes the tabs it finished", async () => {
    server$.events = []; server$.submittedPages = []; server$.allowed = true;
    server$.queue = [item(1, "single"), item(2, "steps"), item(3, "question"), item(4, "captcha"), item(5, "single", { company: "Zeta Corp" }), item(6, "silent"), item(7, "single", { status: "assisted_pending" })];
    const popup = await popupPage();
    const r = await popup.evaluate(() => CA.runQueue()) as { results: { id: string; outcome: string; why: string | null }[]; stopped: string | null };

    const outcome = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(outcome[id(1)].outcome).toBe("submitted");
    expect(outcome[id(2)].outcome).toBe("submitted");
    expect(outcome[id(3)]).toMatchObject({ outcome: "blocked" });
    expect(outcome[id(3)].why).toMatch(/not complete: .*Describe your leadership style/);
    expect(outcome[id(4)].why).toMatch(/captcha/);
    expect(outcome[id(5)].why).toMatch(/does not mention Zeta Corp/);
    expect(outcome[id(6)].outcome).toBe("unconfirmed");
    expect(outcome[id(6)].why).toMatch(/no confirmation message appeared/);
    expect(outcome[id(7)]).toBeUndefined(); // waiting for the Mac assistant: not taken unless asked

    // what the employer's pages received: the single-page form with the tailored resume attached, the two-page form through Next
    expect(server$.submittedPages).toEqual(expect.arrayContaining(["Resume-1.docx", "steps", "silent"]));
    expect(server$.submittedPages).not.toContain("question");
    expect(server$.submittedPages).not.toContain("captcha");

    // what Career Agent was told: a claim for every one taken, the employer's own words for the two that were sent, and a reason for each given back
    expect(by("claim").map((e) => e.applicationId)).toEqual([id(1), id(2), id(3), id(4), id(5), id(6)]);
    expect(by("submitted").map((e) => e.applicationId)).toEqual([id(1), id(2)]);
    expect(by("submitted")[0].confirmation).toMatch(/Thank you for applying to Acme/);
    expect(by("release").map((e) => e.applicationId)).toEqual([id(3), id(4), id(5), id(6)]);
    expect(by("release").every((e) => (e.note ?? "").length > 10)).toBe(true);

    // the finished and the given-back tabs are closed; only the one whose Submit was not confirmed stays open for you to check
    const open = ctx!.pages().map((p) => p.url()).filter((u) => u.includes("/form/"));
    expect(open).toEqual([`${base}/form/silent`]);

    // a second run does not reopen what stopped on something for you
    server$.events = [];
    const again = await popup.evaluate(() => CA.runQueue()) as { results: unknown[] };
    expect(again.results).toEqual([]);
    expect(by("claim")).toEqual([]);
    await popup.close();
  }, 180_000);

  live("does nothing, and says why, when Career Agent does not allow automatic submitting", async () => {
    server$.events = []; server$.allowed = false;
    server$.queue = [item(1, "single")];
    const popup = await popupPage();
    const r = await popup.evaluate(() => CA.runQueue()) as { results: unknown[]; stopped: string };
    expect(r.results).toEqual([]);
    expect(r.stopped).toMatch(/Auto-Apply is switched off/);
    expect(server$.events).toEqual([]);
    await popup.close();
  }, 60_000);

  live("stops the whole run when the app refuses a claim for every application (a daily limit reached meanwhile)", async () => {
    server$.events = []; server$.allowed = true; server$.refuseClaim = true;
    server$.queue = [item(1, "single"), item(2, "steps")];
    const popup = await popupPage();
    const r = await popup.evaluate(() => CA.runQueue()) as { results: unknown[]; stopped: string };
    expect(r.stopped).toMatch(/Auto-Apply is switched off/);
    expect(r.results).toEqual([]);
    expect(by("claim")).toHaveLength(1); // the second one was not even tried
    server$.refuseClaim = false;
    await popup.close();
  }, 60_000);
});

declare const chrome: { storage: { local: { set(o: unknown): Promise<void>; get(k: string): Promise<Record<string, any>> } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const CA: { runQueue(): Promise<unknown> };
