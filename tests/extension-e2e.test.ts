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
 * The real extension, loaded into a real Chromium, talking to a stand-in for the app: it fetches the data with the link code, opens the waiting
 * application in a new tab, fills it, attaches the resume that the app serves for it, and never presses Submit. (The browser's own "allow all sites"
 * question cannot be answered by a test, so the test copy of the manifest grants those sites up front; everything else is the shipped code.)
 */
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
const live = it.skipIf(!executablePath);

const TOKEN = makeToken("legacy");
const APP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8716 1454", location: "Singapore", links: [] },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Ran training workshops" }] }],
  preferences: { countries: [], roles: [], noticePeriod: "60 days" },
});

const seen = { auth: [] as string[], marked: [] as string[], queue: true };
let server: Server, base = "", ctx: BrowserContext | undefined, extDir = "";

const FORM = `<!doctype html><html><body><form onsubmit="window.submitted = true; return false;">
  <label for="n">Full name*</label><input id="n" required>
  <label for="e">Email*</label><input id="e" type="email" required>
  <label for="np">Notice period*</label><input id="np" required>
  <label for="r">Resume/CV*</label><input type="file" id="r">
  <label for="pw">Password*</label><input id="pw" type="password">
  <button type="submit">Submit application</button></form><script>window.submitted = false;</script></body></html>`;

function handler(req: IncomingMessage, res: ServerResponse) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/form") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(FORM); }
  const auth = req.headers.authorization ?? "";
  if (url.pathname.startsWith("/api/extension/")) {
    seen.auth.push(`${url.pathname}:${auth === `Bearer ${TOKEN}` ? "ok" : "bad"}`);
    if (auth !== `Bearer ${TOKEN}`) { res.writeHead(401, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "This link code is not valid. Make a new one in Career Agent: Profile." })); }
  }
  if (url.pathname === "/api/extension/data") {
    const queue = seen.queue ? [{ id: APP_ID, company: "Acme", title: "Head of Ops", formUrl: `${base}/form`, note: "Waiting for you or the assistant", resume: { name: "Resume-Acme.docx" }, cover: null }] : [];
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ...buildFillData(profile, [{ question: "What is your notice period?", answer: "60 days" }]), queue, defaultResume: { name: "Master-Resume.pdf" }, latestExtensionVersion: "9.9.9" }));
  }
  if (url.pathname === "/api/extension/file" && url.searchParams.get("application") === APP_ID) {
    res.writeHead(200, { ...cors, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    return res.end(Buffer.from("TAILORED RESUME FOR ACME"));
  }
  if (url.pathname === "/api/extension/file" && url.searchParams.get("kind") === "master") {
    res.writeHead(200, { ...cors, "Content-Type": "application/pdf" });
    return res.end(Buffer.from("MY DEFAULT RESUME"));
  }
  if (url.pathname === "/api/extension/mark" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { seen.marked.push(JSON.parse(body).applicationId); seen.queue = false; res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end("{}"); });
    return;
  }
  res.writeHead(404, cors); res.end();
}

beforeAll(async () => {
  if (!executablePath) return;
  execFileSync("node", ["scripts/build-extension.mjs"], { stdio: "ignore" });
  extDir = mkdtempSync(join(tmpdir(), "ca-ext-"));
  cpSync("extension/dist", extDir, { recursive: true });
  const m = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ ...m, host_permissions: ["http://127.0.0.1/*"] }));
  await new Promise<void>((ok) => { server = createServer(handler).listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); });
  try {
    ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ca-prof-")), { executablePath, headless: false, args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-sandbox"] });
  } catch { ctx = undefined; }
}, 60_000);
afterAll(async () => { await ctx?.close(); server?.close(); });

describe("the extension in a real browser", () => {
  live("syncs from the app with the link code, opens the waiting application, fills it, attaches its resume and does not submit", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token } }), [base, TOKEN]);

    // the data comes from the app by itself: nothing is pasted
    expect(await popup.evaluate(() => CA.refresh())).toEqual({ source: "app" });
    expect(await popup.evaluate(async () => (await chrome.storage.local.get("fillData")).fillData.applicant.name)).toBe("Asha Rao");

    const formPage = ctx.waitForEvent("page", { predicate: (p) => p.url().endsWith("/form"), timeout: 20_000 });
    expect(await popup.evaluate((id) => chrome.runtime.sendMessage({ type: "open-and-fill", id }), APP_ID)).toEqual({ ok: true });
    const page = await formPage;
    expect(await page.inputValue("#n")).toBe("Asha Rao");
    expect(await page.inputValue("#e")).toBe("asha@example.com");
    expect(await page.inputValue("#np")).toBe("60 days");
    expect(await page.inputValue("#pw")).toBe("");
    expect(await page.evaluate(async () => { const f = (document.getElementById("r") as HTMLInputElement).files!; return f.length ? [f[0].name, await f[0].text()] : null; })).toEqual(["Resume-Acme.docx", "TAILORED RESUME FOR ACME"]);
    expect(await page.evaluate(() => (window as unknown as { submitted: boolean }).submitted)).toBe(false);

    // the popup tells what happened and offers "I submitted it", which the app is told about
    await popup.reload();
    await popup.waitForSelector(".item");
    expect(await popup.textContent("#update")).toMatch(/newer extension \(9\.9\.9\)/);
    expect(await popup.textContent(".item .note")).toMatch(/Attached: Resume-Acme\.docx/);
    expect(await popup.textContent(".item .note")).toMatch(/You type yourself \(never filled\): Password/);
    await popup.click("text=I submitted it");
    await popup.waitForFunction(() => !document.querySelector(".item .note"));
    expect(seen.marked).toEqual([APP_ID]);
    expect(seen.auth.every((a) => a.endsWith(":ok"))).toBe(true);
  }, 60_000);

  live("a page that is not one of your applications is filled from your data with your default resume", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const sw = ctx.serviceWorkers()[0];
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token } }), [base, TOKEN]);
    await popup.evaluate(() => CA.refresh());
    const other = await ctx.newPage();
    await other.goto(`${base}/form`);
    const tabId = await popup.evaluate(async (u) => Math.max(...(await chrome.tabs.query({ url: u })).map((t) => t.id)), `${base}/form`); // the newest tab: the first test left its own form page open
    const report = await popup.evaluate(([id]) => CA.fillTab(id, { id: "default", isDefault: true, resume: { name: "Master-Resume.pdf" }, cover: null }), [tabId]);
    expect((report as { files: { attached: string[]; missing: string[] } }).files, JSON.stringify(report)).toMatchObject({ attached: ["Master-Resume.pdf"] });
    expect(await other.inputValue("#n")).toBe("Asha Rao");
    expect(await other.evaluate(async () => { const f = (document.getElementById("r") as HTMLInputElement).files!; return f.length ? [f[0].name, await f[0].text()] : null; })).toEqual(["Master-Resume.pdf", "MY DEFAULT RESUME"]);
    expect(await other.evaluate(() => (window as unknown as { submitted: boolean }).submitted)).toBe(false);

    // the popup offers the default resume, and says why it is chosen
    await popup.reload();
    await popup.waitForSelector("#forapp option", { state: "attached" });
    expect(await popup.$$eval("#forapp option", (o) => o.map((x) => x.textContent))).toContain("Upload my default resume (Master-Resume.pdf)");
    expect(await popup.inputValue("#forapp")).toBe("default");
    expect(await popup.textContent("#forappNote")).toMatch(/not one of your applications: your default resume is used/);
  }, 60_000);

  live("only the default mode runs by itself: manual only hides the automatic panel and stops the timer", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const sw = ctx.serviceWorkers()[0];
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token }, settings: { autoRun: true, mode: "fallback" } }), [base, TOKEN]);
    await popup.reload();
    await popup.waitForSelector('input[name="mode"]');
    expect(await popup.isVisible("#panel-fallback")).toBe(true);
    await popup.click('input[value="manual"]');
    await popup.waitForFunction(() => document.getElementById("panel-fallback")!.hidden);
    expect(await popup.evaluate(async () => (await chrome.storage.local.get("settings")).settings.mode)).toBe("manual");
    expect(await popup.evaluate(async () => (await chrome.alarms.getAll()).some((a: { name: string }) => a.name === "queue"))).toBe(false);
    await popup.click('input[value="fallback"]');
    await popup.waitForFunction(() => !document.getElementById("panel-fallback")!.hidden);
    expect(await popup.evaluate(async () => (await chrome.alarms.getAll()).some((a: { name: string }) => a.name === "queue"))).toBe(true);
  }, 60_000);

  live("a revoked or wrong link code is reported in words and the last copy of the data is kept", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const sw = ctx.serviceWorkers()[0];
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token } }), [base, makeToken("legacy")]);
    const r = await popup.evaluate(() => CA.refresh());
    expect(r).toMatchObject({ source: "cache" });
    expect((r as { error: string }).error).toMatch(/no longer valid/);
    expect(await popup.evaluate(async () => !!(await chrome.storage.local.get("fillData")).fillData)).toBe(true);
  }, 30_000);
});

declare const chrome: { storage: { local: { set(o: unknown): Promise<void>; get(k: string): Promise<Record<string, any>> } }; runtime: { sendMessage(m: unknown): Promise<unknown> }; tabs: { query(q: unknown): Promise<{ id: number }[]> }; alarms: { getAll(): Promise<{ name: string }[]> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const CA: { refresh(): Promise<{ source: string; error?: string }>; fillTab(tabId: number, item: unknown): Promise<unknown> };
