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
 * The real extension filling the controls that plain text boxes are not: radio buttons and checkboxes whose own input is hidden behind a styled label, groups of boxes
 * ("select all that apply"), dropdowns that open a list instead of being a <select>, a box that searches a list, and a question asked in a wording nobody saved an answer for
 * (Career Agent is asked, answers, and the form is filled again). The pages are fixtures; a real site's markup differs, which is why none of this depends on a class name.
 */
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
const live = it.skipIf(!executablePath);
const TOKEN = makeToken("legacy");
const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8716 1454", location: "Singapore", links: [] },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Ran training workshops" }] }],
  preferences: { countries: [], roles: [], noticePeriod: "60 days" },
});
const BANK = [
  { question: "Are you legally authorised to work in Singapore?", answer: "Yes" },
  { question: "Will you now or in the future require visa sponsorship?", answer: "No" },
  { question: "What is your notice period?", answer: "60 days" },
  { question: "Which of these languages do you speak?", answer: "English; Hindi" },
  { question: "Are you willing to relocate?", answer: "Yes" },
];
const seen = { asked: [] as { question: string; options: string[]; kind: string }[] };
let server: Server, base = "", ctx: BrowserContext | undefined;

function handler(req: IncomingMessage, res: ServerResponse) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST" };
  const json = (status: number, body: unknown) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url ?? "/", base);
  if (url.pathname === "/form") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(FORM); }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "bad token" });
  if (url.pathname === "/api/extension/data") return json(200, { ...buildFillData(profile, BANK), queue: [], autoSubmit: { allowed: true, remainingToday: 5, why: null }, latestExtensionVersion: "1.6.0" });
  if (url.pathname === "/api/extension/answer" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { questions } = JSON.parse(body) as { questions: { question: string; options: string[]; kind: string }[] };
      seen.asked.push(...questions);
      // the stand-in AI knows one thing: the profile says English is fluent
      return json(200, { answers: questions.map((q) => (/english/i.test(q.question) ? { question: q.question, answer: "Yes", why: "written by the AI", source: "ai" } : { question: q.question, answer: null, why: "the profile does not answer it", source: "none" })) });
    });
    return;
  }
  json(404, {});
}

// radio and checkbox inputs are hidden (zero size) behind visible labels, as on LinkedIn; the dropdowns are not <select>s
const FORM = `<!doctype html><html><head><style>
  .hid { position:absolute; opacity:0; width:0; height:0; }
  label.opt { display:inline-block; padding:4px 10px; border:1px solid #999; margin:2px; cursor:pointer }
  .menu { border:1px solid #999; position:absolute; background:#fff; z-index:5 } .menu div { padding:4px 10px; cursor:pointer }
</style></head><body><div role="dialog" aria-modal="true" id="dlg">
  <fieldset id="fs1"><legend>Are you legally authorized to work in Singapore?*</legend>
    <input class="hid" type="radio" name="auth" id="a1" value="y"><label class="opt" for="a1">Yes</label>
    <input class="hid" type="radio" name="auth" id="a2" value="n"><label class="opt" for="a2">No</label></fieldset>
  <fieldset id="fs2"><legend>Do you require visa sponsorship now or in future?*</legend>
    <input class="hid" type="radio" name="spons" id="s1"><label class="opt" for="s1">Yes</label>
    <input class="hid" type="radio" name="spons" id="s2"><label class="opt" for="s2">No</label></fieldset>
  <fieldset id="fs3"><legend>Which languages do you speak? Select all that apply.*</legend>
    <input class="hid" type="checkbox" id="l1"><label class="opt" for="l1">English</label>
    <input class="hid" type="checkbox" id="l2"><label class="opt" for="l2">Hindi</label>
    <input class="hid" type="checkbox" id="l3"><label class="opt" for="l3">French</label></fieldset>
  <fieldset id="fs4"><legend>Would you be open to relocation?*</legend>
    <input class="hid" type="radio" name="reloc" id="r1"><label class="opt" for="r1">Yes</label>
    <input class="hid" type="radio" name="reloc" id="r2"><label class="opt" for="r2">No</label></fieldset>
  <fieldset id="fs5"><legend>Are you fluent in English?*</legend>
    <input class="hid" type="radio" name="eng" id="e1"><label class="opt" for="e1">Yes</label>
    <input class="hid" type="radio" name="eng" id="e2"><label class="opt" for="e2">No</label></fieldset>
  <fieldset id="fs6"><legend>Do you hold a pilot licence?*</legend>
    <input class="hid" type="radio" name="pilot" id="p1"><label class="opt" for="p1">Yes</label>
    <input class="hid" type="radio" name="pilot" id="p2"><label class="opt" for="p2">No</label></fieldset>
  <div><span id="np-label">Notice period*</span>
    <div id="np" role="combobox" aria-labelledby="np-label" aria-haspopup="listbox" aria-expanded="false" tabindex="0" style="border:1px solid #999;padding:4px;width:200px">Select an option</div></div>
  <div><label for="country">Country*</label><input id="country" role="combobox" aria-haspopup="listbox" autocomplete="off" aria-required="true"></div>
  <label for="cc">Phone country code*</label><select id="cc" required><option value="">Select an option</option><option>India (+91)</option><option>Singapore (+65)</option></select>
  <label class="opt"><input class="hid" type="checkbox" id="c1" required> I certify that the answers are true*</label>
</div>
<div id="portal"></div>
<script>
  const portal = document.getElementById("portal");
  const np = document.getElementById("np");
  function menu(anchor, items, onPick) {
    portal.innerHTML = ""; const m = document.createElement("div"); m.className = "menu"; m.setAttribute("role", "listbox");
    for (const t of items) { const o = document.createElement("div"); o.setAttribute("role", "option"); o.textContent = t; o.addEventListener("mousedown", () => { onPick(t); portal.innerHTML = ""; }); m.append(o); }
    const r = anchor.getBoundingClientRect(); m.style.left = r.left + "px"; m.style.top = (r.bottom + 2) + "px"; portal.append(m);
  }
  np.addEventListener("mousedown", () => menu(np, ["30 days", "60 days", "90 days"], (t) => { np.textContent = t; }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") portal.innerHTML = ""; });
  const country = document.getElementById("country");
  const COUNTRIES = ["Australia", "Singapore", "Singapore (Central)", "India"];
  country.addEventListener("input", () => { const q = country.value.toLowerCase(); menu(country, COUNTRIES.filter((c) => c.toLowerCase().includes(q)), (t) => { country.value = t; country.dataset.chosen = t; }); });
  country.addEventListener("focus", () => {});
</script></body></html>`;

beforeAll(async () => {
  if (!executablePath) return;
  execFileSync("node", ["scripts/build-extension.mjs"], { stdio: "ignore" });
  const extDir = mkdtempSync(join(tmpdir(), "ca-ext-"));
  cpSync("extension/dist", extDir, { recursive: true });
  const m = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ ...m, host_permissions: ["http://127.0.0.1/*"] }));
  await new Promise<void>((ok) => { server = createServer(handler).listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); });
  try { ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ca-prof-")), { executablePath, headless: false, args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-sandbox"] }); } catch { ctx = undefined; }
}, 60_000);
afterAll(async () => { await ctx?.close(); server?.close(); });

describe("the real extension filling every kind of control", () => {
  live("fills hidden radio buttons, checkbox groups, list dropdowns, a searching box and a <select>, and asks Career Agent about a question nobody saved an answer for", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token } }), [base, TOKEN]);
    await popup.evaluate(() => CA.refresh());
    const page = await ctx.newPage();
    await page.goto(`${base}/form`);
    const tabId = await popup.evaluate(async (u) => Math.max(...(await chrome.tabs.query({ url: u })).map((t) => t.id)), `${base}/form`);
    seen.asked = [];
    const report = (await popup.evaluate(([id]) => CA.fillTab(id, null, []), [tabId])) as { filled: string[]; forYou: string[]; questions: { label: string }[]; learned: { question: string; answer: string }[] };

    const checked = (id: string) => page.evaluate((i) => (document.getElementById(i) as HTMLInputElement).checked, id);
    // yes/no radio buttons with hidden inputs
    expect(await checked("a1")).toBe(true);   // authorised to work: Yes (saved answer)
    expect(await checked("s2")).toBe(true);   // sponsorship: No (saved answer for sponsorship, never the authorisation answer)
    expect(await checked("r1")).toBe(true);   // "open to relocation" is another wording of "willing to relocate"
    // a group of boxes: English and Hindi, not French
    expect([await checked("l1"), await checked("l2"), await checked("l3")]).toEqual([true, true, false]);
    // the consent box is ticked through its label
    expect(await checked("c1")).toBe(true);
    // a <select>, with the phone code from the profile
    expect(await page.inputValue("#cc")).toBe("Singapore (+65)");
    // a dropdown that opens a list, and a box that searches one
    expect(await page.textContent("#np")).toBe("60 days");
    expect(await page.inputValue("#country")).toBe("Singapore");
    // a question in a wording nobody saved: Career Agent was asked, answered, and the form was filled again
    expect(seen.asked.map((q) => q.question)).toContain("Are you fluent in English?");
    expect(seen.asked.find((q) => /fluent/i.test(q.question))).toMatchObject({ options: ["Yes", "No"], kind: "radio" });
    expect(await checked("e1")).toBe(true);
    expect(report.learned.map((l) => l.question)).toEqual(["Are you fluent in English?"]);
    // one nobody can answer is left alone, outlined, and reported with its wording and options
    expect(await checked("p1")).toBe(false);
    expect(await checked("p2")).toBe(false);
    expect(report.questions.map((q) => q.label)).toEqual(["Do you hold a pilot licence?"]);
    expect(report.forYou).toContain("Do you hold a pilot licence?");
  }, 90_000);
});

declare const chrome: { storage: { local: { set(o: unknown): Promise<void>; get(k: string): Promise<Record<string, any>> } }; tabs: { query(q: unknown): Promise<{ id: number }[]> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const CA: { refresh(): Promise<{ source: string }>; fillTab(tabId: number, item: unknown, learned: unknown[]): Promise<unknown> };
