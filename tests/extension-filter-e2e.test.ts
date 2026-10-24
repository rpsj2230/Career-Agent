import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright";
import { buildFillData } from "../src/lib/apply/fill-data";
import { makeToken } from "../src/lib/extension/link";
import { MasterProfile } from "../src/lib/types";

/**
 * Filter Auto Apply in a real Chromium: the real extension works through a LinkedIn-style job list (Easy Apply window with several steps, a question it cannot answer, an
 * already-applied job, a job that applies on the company's site, a duplicate Career Agent refuses, a form that asks for a resume) and a Naukri-style list, against a stand-in
 * for Career Agent. The pages are served at the portals' own addresses but are FIXTURES written from how those sites are laid out: this proves the extension's logic and its
 * dealings with Career Agent, not that LinkedIn's or Naukri's live pages still look like this.
 */
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
const live = it.skipIf(!executablePath);

const TOKEN = makeToken("legacy");
const profile = MasterProfile.parse({
  basics: { name: "Asha Rao", email: "asha@example.com", phone: "+65 8716 1454", location: "Singapore", links: [] },
  experience: [{ id: "e1", company: "Verz", title: "Operations Director", start: "2012", end: "Present", bullets: [{ id: "b", text: "Ran training workshops" }] }],
  preferences: { countries: [], roles: [], noticePeriod: "60 days" },
});

type External = { action: string; portal: string; company: string; title: string; jobKey: string; note?: string; confirmation?: string; questions?: string[] };
const seen = { external: [] as External[], globalStop: false, allowed: true };
let server: Server, base = "", ctx: BrowserContext | undefined, extDir = "";

function handler(req: IncomingMessage, res: ServerResponse) {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST" };
  const json = (status: number, body: unknown) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url ?? "/", base);
  // Naukri job pages are opened by the extension in tabs of its own, which the test cannot intercept at naukri.com, so the list's links point here
  if (url.pathname.startsWith("/naukri/")) { const job = NK_JOBS.find((j) => url.pathname.endsWith(j.id)); res.writeHead(200, { "Content-Type": "text/html" }); return res.end(job ? nkJob(job) : "<p>not found</p>"); }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "This link code is not valid." });
  if (url.pathname === "/api/extension/data") {
    const rules = seen.allowed ? { allowed: true, why: null, remaining: 5 } : { allowed: false, why: "Auto-Apply is switched off in Career Agent (Settings).", remaining: 0 };
    return json(200, { ...buildFillData(profile, [{ question: "What is your notice period?", answer: "60 days" }, { question: "Are you willing to relocate?", answer: "Yes" }]), queue: [], autoSubmit: { allowed: true, remainingToday: 5, why: null }, defaultResume: { name: "Master-Resume.pdf" }, filter: { linkedin: rules, naukri: rules }, latestExtensionVersion: "1.6.0" });
  }
  if (url.pathname === "/api/extension/file" && url.searchParams.get("kind") === "master") { res.writeHead(200, { ...cors, "Content-Type": "application/pdf" }); return res.end(Buffer.from("MY DEFAULT RESUME")); }
  if (url.pathname === "/api/extension/answer" && req.method === "POST") return json(200, { answers: [] }); // nothing more can be learned in these tests
  if (url.pathname === "/api/extension/external" && req.method === "POST") {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = JSON.parse(body) as External;
      seen.external.push(b);
      if (b.action === "check" && seen.globalStop) return json(409, { error: "Today's LinkedIn limit of 10 applications is used up.", global: true });
      if (b.action === "check" && b.title === "Duplicate Role") return json(409, { error: "Career Agent already has this job as sent", global: false });
      return json(200, { ok: true, remaining: 5 });
    });
    return;
  }
  json(404, {});
}

// ---- a LinkedIn-style jobs page ----
const LI_JOBS = [
  { id: "4000000001", title: "Head of Operations", company: "Acme Pte Ltd", flow: "ok" },
  { id: "4000000002", title: "Training Manager", company: "Beta Corp", flow: "ok", applied: true },
  { id: "4000000003", title: "Programme Director", company: "Gamma Ltd", flow: "question" },
  { id: "4000000004", title: "Operations Lead", company: "Delta Inc", flow: "external" },
  { id: "4000000005", title: "Duplicate Role", company: "Epsilon LLC", flow: "ok" },
  { id: "4000000006", title: "Delivery Head", company: "Zeta Pte", flow: "resume" },
];
const liPage = (extra = "") => `<!doctype html><html><body>
<nav id="global-nav"><a href="/mynetwork">My network</a></nav>${extra}
<div id="filters"><button>Jobs</button><button class="pill">Easy Apply</button><button>Date posted</button><button>Company</button><button>Remote</button><button>All filters</button></div>
<div class="scaffold-layout__list jobs-search-results-list" style="height:260px;overflow:auto"><ul>
${LI_JOBS.map((j) => `<li data-occludable-job-id="${j.id}" class="scaffold-layout__list-item"><div class="job-card-container" data-job-id="urn:li:jobPosting:${j.id}">
  <a class="job-card-list__title" href="/jobs/view/${j.id}/">${j.title}</a><div class="artdeco-entity-lockup__subtitle">${j.company}</div>
  <ul class="job-card-container__footer-wrapper"><li id="foot${j.id}" class="${j.applied ? "job-card-container__footer-job-state" : "job-card-container__apply-method"}">${j.applied ? "Applied" : j.flow === "external" ? "Promoted" : "Easy Apply"}</li></ul></div></li>`).join("\n")}
</ul></div>
<div class="jobs-search__job-details--container" id="detail"><p>Select a job</p></div>
<div role="dialog" class="artdeco-modal jobs-easy-apply-modal" id="modal" hidden style="position:fixed;top:20px;left:20px;width:520px;background:#fff;border:1px solid #333;padding:10px">
  <button aria-label="Dismiss" id="x">x</button><h2 id="mt"></h2><div id="body"></div><div id="footer"></div></div>
<div role="dialog" id="confirm" hidden style="position:fixed;top:60px;left:60px;width:400px;background:#fff;border:1px solid #333;padding:10px">
  <h2>Save this application?</h2><button id="discard">Discard</button><button id="save">Save</button></div>
<script>
const JOBS = ${JSON.stringify(Object.fromEntries(LI_JOBS.map((j) => [j.id, j])))};
window.submitted = []; window.discarded = []; window.files = {};
let cur = null, step = 0;
const $ = (id) => document.getElementById(id);
function show(id) {
  const j = JOBS[id]; history.replaceState(null, "", "?currentJobId=" + id);
  const apply = j.applied ? "" : j.flow === "external" ? '<button class="jobs-apply-button"><span>Apply</span></button>' : '<button class="jobs-apply-button"><span>Easy Apply</span></button>';
  $("detail").innerHTML = '<div class="job-details-jobs-unified-top-card__primary-description-container">Singapore · 2 days ago · 31 applicants</div><h1 class="job-details-jobs-unified-top-card__job-title">' + j.title + '</h1><div class="job-details-jobs-unified-top-card__company-name"><a>' + j.company + '</a></div>' + (j.applied ? "<p>Applied 2 weeks ago</p>" : "") + apply + '<p>About the job: lead operations.</p>';
  const b = $("detail").querySelector(".jobs-apply-button"); if (b) b.onclick = () => { cur = id; step = 0; $("modal").hidden = false; render(); };
}
document.querySelector(".scaffold-layout__list").addEventListener("click", (e) => { const li = e.target.closest("li[data-occludable-job-id]"); if (li) { e.preventDefault(); show(li.dataset.occludableJobId); } });
function render() {
  const j = JOBS[cur]; $("mt").textContent = "Apply to " + j.company; const body = $("body"), foot = $("footer");
  if (step === 0) { body.innerHTML = '<h3>Contact info</h3><label for="ph">Mobile phone number*</label><input id="ph" required><label for="em">Email address*</label><select id="em" required><option>asha@example.com</option></select>'; foot.innerHTML = '<button id="next">Next</button>'; }
  else if (step === 1) {
    body.innerHTML = j.flow === "question" ? '<h3>Additional questions</h3><label for="q">Why do you want this role?*</label><textarea id="q" required></textarea>'
      : j.flow === "resume" ? '<h3>Resume</h3><label for="rs">Resume*</label><input type="file" id="rs" required aria-label="Resume">'
      : '<h3>Additional questions</h3><label for="y">How many years of work experience do you have with Training?*</label><input id="y" required>';
    foot.innerHTML = '<button id="next">Review</button>';
  } else if (step === 2) { body.innerHTML = '<h3>Review your application</h3><p>' + j.company + '</p>'; foot.innerHTML = '<button id="submit">Submit application</button>'; }
}
$("footer").addEventListener("click", (e) => {
  if (e.target.id === "next") {
    const bad = [...$("body").querySelectorAll("input,textarea,select")].filter((x) => !x.checkValidity());
    if (bad.length) { bad.forEach((x) => x.setAttribute("aria-invalid", "true")); return; }
    const f = $("rs"); if (f && f.files.length) window.files[cur] = f.files[0].name;
    step++; render();
  }
  if (e.target.id === "submit") { window.submitted.push(cur); $("footer").innerHTML = ""; $("body").innerHTML = '<h3>Application sent</h3><p>Your application was sent to ' + JOBS[cur].company + '</p><button id="done">Done</button>'; $("foot" + cur).textContent = "Applied"; }
});
$("body").addEventListener("click", (e) => { if (e.target.id === "done") $("modal").hidden = true; });
$("x").onclick = () => { if (window.submitted.includes(cur)) { $("modal").hidden = true; } else $("confirm").hidden = false; };
$("discard").onclick = () => { window.discarded.push(cur); $("confirm").hidden = true; $("modal").hidden = true; };
$("save").onclick = () => { $("confirm").hidden = true; $("modal").hidden = true; };
</script></body></html>`;

// ---- a Naukri-style list and job pages ----
const NK_JOBS = [
  { id: "111111111111", title: "Head of Ops", company: "Acme Pte", kind: "instant" },
  { id: "222222222222", title: "Programme Lead", company: "Gamma Ltd", kind: "questions" },
  { id: "333333333333", title: "Operations Lead", company: "Delta Inc", kind: "external" },
  { id: "444444444444", title: "Training Head", company: "Beta Corp", kind: "applied" },
];
const nkUrl = (j: (typeof NK_JOBS)[number]) => `${base}/naukri/job-listings-${j.title.toLowerCase().replace(/ /g, "-")}-${j.id}`;
const nkList = () => `<!doctype html><html><body>${NK_JOBS.map((j) => `<div class="srp-jobtuple-wrapper"><a class="title" href="${nkUrl(j)}">${j.title}</a><a class="comp-name">${j.company}</a></div>`).join("")}</body></html>`;
function nkJob(j: (typeof NK_JOBS)[number]) {
  const head = `<h1>${j.title}</h1><p>${j.company}</p>`;
  if (j.kind === "external") return `<!doctype html><html><body>${head}<button id="company-site-button">Apply on company site</button></body></html>`;
  if (j.kind === "applied") return `<!doctype html><html><body>${head}<p>You have already applied to this job</p></body></html>`;
  const onclick = j.kind === "instant"
    ? `document.body.insertAdjacentHTML("beforeend", "<div>You have successfully applied to ${j.title}</div>")`
    : `document.body.insertAdjacentHTML("beforeend", '<div class="chatbot_Drawer" style="position:fixed;right:0;top:0;width:300px;background:#fff"><label for="q">Describe your biggest achievement*</label><textarea id="q" required></textarea><button id="save">Save</button></div>')`;
  return `<!doctype html><html><body>${head}<button id="apply-button" onclick='${onclick}'>Apply</button></body></html>`;
}


// ---- LinkedIn's newer layout: no class names to rely on, the apply control is a link, the steps are in a window or on a page of their own ----
const NEW_JOBS = [
  { id: "4100000001", title: "Senior Change Manager", company: "Bluefin Resources", flow: "dialog" },
  { id: "4100000002", title: "AI Programme Lead", company: "Whizdom", flow: "page" },
  { id: "4100000003", title: "Delivery Director", company: "Zephyr Pte", flow: "question" },
];
const sentIds: string[] = [];
const HID = "<style>.hid{position:absolute;opacity:0;width:0;height:0} label{display:inline-block;padding:3px 9px;border:1px solid #999;margin:2px}</style>";
// the steps of an application, shared by the window and the page of its own: what is asked depends on window.FLOW, and window.JOBID says which job it is for
const STEPS = `
  var $ = function (i) { return document.getElementById(i); };
  var step = 0;
  function render() {
    var body = $("body"), foot = $("foot");
    if (step === 0) { body.innerHTML = '<h3>Contact info</h3><label for="ph">Mobile phone number*</label><input id="ph" required>'; foot.innerHTML = '<button id="next">Next</button>'; }
    else if (step === 1) {
      body.innerHTML = window.FLOW === "question" ? '<fieldset><legend>Do you hold a pilot licence?*</legend><input class="hid" type="radio" name="p" id="p1"><label for="p1">Yes</label><input class="hid" type="radio" name="p" id="p2"><label for="p2">No</label></fieldset>'
        : window.FLOW === "page" ? '<span id="nl">Notice period*</span><div id="np" role="combobox" aria-labelledby="nl" aria-haspopup="listbox" tabindex="0" style="border:1px solid #999;padding:4px;width:200px">Select an option</div><div id="portal"></div>'
        : '<fieldset><legend>Would you be open to relocation?*</legend><input class="hid" type="radio" name="r" id="r1"><label for="r1">Yes</label><input class="hid" type="radio" name="r" id="r2"><label for="r2">No</label></fieldset>';
      foot.innerHTML = '<button id="next">Review</button>';
      var np = $("np");
      if (np) np.addEventListener("mousedown", function () { var m = document.createElement("div"); m.setAttribute("role", "listbox"); ["30 days", "60 days"].forEach(function (t) { var o = document.createElement("div"); o.setAttribute("role", "option"); o.textContent = t; o.addEventListener("mousedown", function () { np.textContent = t; $("portal").innerHTML = ""; }); m.append(o); }); $("portal").innerHTML = ""; $("portal").append(m); });
    } else if (step === 2) { body.innerHTML = '<h3>Review your application</h3>'; foot.innerHTML = '<button id="submit">Submit application</button>'; }
  }
  document.addEventListener("click", function (e) {
    if (e.target.id === "next") {
      var bad = [].filter.call($("body").querySelectorAll("input"), function (x) { return x.type !== "radio" && !x.checkValidity(); });
      var open = [].filter.call($("body").querySelectorAll("fieldset"), function (f) { return !f.querySelector("input:checked"); });
      var np = $("np"), npBad = np && /^Select/.test(np.textContent);
      if (bad.length || open.length || npBad) { bad.forEach(function (x) { x.setAttribute("aria-invalid", "true"); }); open.forEach(function (f) { f.setAttribute("aria-invalid", "true"); }); return; }
      step++; render();
    }
    if (e.target.id === "submit") { fetch("/__sent?id=" + window.JOBID); $("foot").innerHTML = ""; $("body").innerHTML = '<h3>Application sent</h3><p>Your application was sent</p><button id="done">Done</button>'; window.SENT = true; }
    if (e.target.id === "done" && $("dlg")) $("dlg").hidden = true;
  });`;
const applyPage = (id: string, flow: string) => `<!doctype html><html><body>${HID}<main><h2>Apply</h2><div id="body"></div><div id="foot"></div></main><script>window.FLOW=${JSON.stringify(flow)};window.JOBID=${JSON.stringify(id)};${STEPS} render();</script></body></html>`;
const liNewPage = () => `<!doctype html><html><body>${HID}
<header id="global-nav"><a href="/feed/">Home</a></header>
<div><button aria-pressed="true">Easy Apply</button><button>Date posted</button><button>Company</button><button>Remote</button><button>All filters</button></div>
<div style="display:flex;width:1200px"><div id="left" style="width:500px;height:520px;overflow:auto">
${NEW_JOBS.map((j) => `<div class="x9"><div class="x8"><a href="/jobs/search-results/?currentJobId=${j.id}&keywords=ai">${j.title}</a><div>${j.company}</div><div>Melbourne, VIC (On-site)</div><div>3 weeks ago · Easy Apply</div></div></div>`).join("")}
</div><div id="right" style="width:600px"><p>Select a job</p></div></div>
<div role="dialog" aria-label="Apply" id="dlg" hidden style="position:fixed;top:20px;left:20px;width:480px;background:#fff;border:1px solid #333;padding:10px"><button aria-label="Dismiss" id="x">x</button><div id="body"></div><div id="foot"></div></div>
<div role="dialog" id="confirm" hidden style="position:fixed;top:60px;left:60px;background:#fff;border:1px solid #333;padding:10px"><h3>Save this application?</h3><button id="discard">Discard</button><button id="save">Save</button></div>
<script>
window.discarded = [];
var JOBS = ${JSON.stringify(Object.fromEntries(NEW_JOBS.map((j) => [j.id, j])))};
${STEPS}
document.getElementById("left").addEventListener("click", function (e) { var a = e.target.closest("a"); if (!a) return; e.preventDefault(); var id = new URL(a.href).searchParams.get("currentJobId"); history.replaceState(null, "", "?currentJobId=" + id); show(id); });
function show(id) {
  var j = JOBS[id];
  $("right").innerHTML = '<h2>' + j.title + '</h2><a href="/company/x/">' + j.company + '</a><div><a href="/jobs/view/' + id + '/apply/?openSDUIApplyFlow=true" id="apply">Easy Apply</a> <button>Save</button></div><p>About the job</p>';
  if (j.flow !== "page") $("apply").addEventListener("click", function (e) { e.preventDefault(); window.FLOW = j.flow; window.JOBID = id; window.SENT = false; step = 0; $("dlg").hidden = false; render(); });
}
$("x").onclick = function () { if (window.SENT) $("dlg").hidden = true; else $("confirm").hidden = false; };
$("discard").onclick = function () { window.discarded.push(window.JOBID); $("confirm").hidden = true; $("dlg").hidden = true; };
$("save").onclick = function () { $("confirm").hidden = true; $("dlg").hidden = true; };
</script></body></html>`;

async function startContext() {
  execFileSync("node", ["scripts/build-extension.mjs"], { stdio: "ignore" });
  extDir = mkdtempSync(join(tmpdir(), "ca-ext-"));
  cpSync("extension/dist", extDir, { recursive: true });
  const m = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  writeFileSync(join(extDir, "manifest.json"), JSON.stringify({ ...m, host_permissions: ["http://127.0.0.1/*", "https://www.linkedin.com/*", "https://www.naukri.com/*"] }));
  await new Promise<void>((ok) => { server = createServer(handler).listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); });
  const c = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ca-prof-")), { executablePath, headless: false, args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-sandbox"] });
  let linkedinHtml = liPage();
  await c.route("https://www.linkedin.com/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/__sent") { sentIds.push(u.searchParams.get("id") ?? ""); return route.fulfill({ status: 200, body: "ok" }); }
    const applying = u.pathname.match(/^\/jobs\/view\/(\d+)\/apply\/$/);
    if (applying) return route.fulfill({ contentType: "text/html", body: applyPage(applying[1], NEW_JOBS.find((j) => j.id === applying[1])?.flow ?? "dialog") });
    return route.fulfill({ contentType: "text/html", body: u.pathname.startsWith("/jobs/search-results") ? liNewPage() : linkedinHtml });
  });
  await c.route("https://www.naukri.com/**", (route) => route.fulfill({ contentType: "text/html", body: nkList() }));
  (c as unknown as { setLinkedin(h: string): void }).setLinkedin = (h) => { linkedinHtml = h; };
  return c;
}

beforeAll(async () => { if (!executablePath) return; try { ctx = await startContext(); } catch { ctx = undefined; } }, 90_000);
afterAll(async () => { await ctx?.close(); server?.close(); });

async function popupPage(c: BrowserContext): Promise<Page> {
  const sw = c.serviceWorkers()[0] ?? (await c.waitForEvent("serviceworker", { timeout: 15_000 }));
  const popup = await c.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.evaluate(([origin, token]) => chrome.storage.local.set({ link: { origin, token }, settings: { mode: "filter" } }), [base, TOKEN]);
  await sw.evaluate(() => { (CA as unknown as { PACE_MS: number }).PACE_MS = 200; }); // a short pause between jobs, for the test only
  return popup;
}
async function runFilter(popup: Page, tab: Page, max = 10) {
  await popup.evaluate(() => chrome.storage.local.remove("filterRun"));
  const tabId = await popup.evaluate(async (u) => Math.max(...(await chrome.tabs.query({ url: u })).map((t) => t.id)), new URL(tab.url()).origin + "/*");
  await popup.evaluate(([id, n]) => chrome.runtime.sendMessage({ type: "run-filter", tabId: id, max: n }), [tabId, max]);
}
async function finished(popup: Page, timeout = 150_000) {
  type Run = { results: { id: string; company: string; outcome: string; why: string | null }[]; stopped?: string | null; running?: boolean };
  const end = Date.now() + timeout;
  for (;;) {
    const r = await popup.evaluate(async () => (await chrome.storage.local.get("filterRun")).filterRun as Run | undefined);
    if (r && r.running === false) return r;
    if (Date.now() > end) throw new Error("the run did not finish: " + JSON.stringify(r));
    await popup.waitForTimeout(500);
  }
}

describe("Filter Auto Apply in a real browser", () => {
  live("works through a filtered LinkedIn list: applies, skips, hands back, and tells Career Agent about each", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const popup = await popupPage(ctx);
    expect(await popup.evaluate(() => CA.refresh())).toEqual({ source: "app" });
    seen.external = []; seen.globalStop = false; seen.allowed = true;
    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/jobs/search/?f_AL=true");
    await runFilter(popup, page);
    const run = await finished(popup);

    const by = Object.fromEntries(run.results.map((r) => [r.id, r]));
    expect(by["4000000001"], JSON.stringify(run)).toMatchObject({ outcome: "submitted", company: "Acme Pte Ltd" });
    expect(by["4000000002"]).toMatchObject({ outcome: "skipped", why: expect.stringMatching(/Applied/) });
    expect(by["4000000003"]).toMatchObject({ outcome: "blocked", why: expect.stringMatching(/Why do you want this role/) });
    expect(by["4000000004"]).toMatchObject({ outcome: "skipped" });
    expect(by["4000000005"]).toMatchObject({ outcome: "skipped", why: expect.stringMatching(/already has this job as sent/) });
    expect(by["4000000006"]).toMatchObject({ outcome: "submitted", company: "Zeta Pte" });
    expect(run.stopped ?? null).toBeNull();

    // what the page itself saw: two applications sent, the unanswerable one discarded, the default resume attached only where the form asked for one
    expect(await page.evaluate(() => (window as unknown as { submitted: string[] }).submitted)).toEqual(["4000000001", "4000000006"]);
    expect(await page.evaluate(() => (window as unknown as { discarded: string[] }).discarded)).toEqual(["4000000003"]);
    expect(await page.evaluate(() => (window as unknown as { files: Record<string, string> }).files)).toEqual({ "4000000006": "Master-Resume.pdf" });
    expect(await page.isVisible("#modal")).toBe(false);

    // what Career Agent was told
    const told = seen.external.map((e) => `${e.action}:${e.jobKey}`);
    expect(told).toEqual(["check:4000000001", "submitted:4000000001", "check:4000000003", "needs_input:4000000003", "check:4000000005", "check:4000000006", "submitted:4000000006"]);
    expect(seen.external.find((e) => e.action === "submitted" && e.jobKey === "4000000001")).toMatchObject({ portal: "linkedin", title: "Head of Operations", confirmation: expect.stringMatching(/application was sent to Acme/i) });
    expect(seen.external.find((e) => e.action === "needs_input")!.note).toMatch(/Why do you want this role/);

    // the popup says what happened
    await popup.reload();
    await popup.waitForSelector("#filterOut");
    expect(await popup.textContent("#filterOut")).toMatch(/2 sent, 1 given back to you, 3 skipped/);
  }, 180_000);

  live("works on LinkedIn's newer layout: finds the jobs without class names, fills a window and a page of its own, hidden radio buttons and a list dropdown, and gives back a question nobody can answer", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const popup = await popupPage(ctx);
    await popup.evaluate(() => CA.refresh());
    seen.external = []; seen.globalStop = false; seen.allowed = true; sentIds.length = 0;
    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/jobs/search-results/?currentJobId=4100000001&keywords=ai");
    await runFilter(popup, page);
    const run = await finished(popup, 160_000);
    const by = Object.fromEntries(run.results.map((r) => [r.id, r]));
    expect(by["4100000001"], JSON.stringify(run)).toMatchObject({ outcome: "submitted", company: "Bluefin Resources" });
    expect(by["4100000002"], JSON.stringify(run)).toMatchObject({ outcome: "submitted", company: "Whizdom" });
    expect(by["4100000003"], JSON.stringify(run)).toMatchObject({ outcome: "blocked" });
    expect(sentIds.sort()).toEqual(["4100000001", "4100000002"]);
    expect(await page.evaluate(() => (window as unknown as { discarded: string[] }).discarded)).toEqual(["4100000003"]);
    expect(page.url()).toContain("/jobs/search-results/");
    const handBack = seen.external.find((e) => e.action === "needs_input");
    expect(handBack).toMatchObject({ jobKey: "4100000003", questions: ["Do you hold a pilot licence?"] });
    expect(seen.external.filter((e) => e.action === "submitted").map((e) => e.jobKey)).toEqual(["4100000001", "4100000002"]);
  }, 200_000);

  live("stops the whole run when Career Agent says a limit is reached, and when LinkedIn asks for a security check", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const popup = await popupPage(ctx);
    await popup.evaluate(() => CA.refresh());

    seen.external = []; seen.globalStop = true;
    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/jobs/search/?f_AL=true");
    await runFilter(popup, page);
    let run = await finished(popup);
    expect(run.stopped).toMatch(/LinkedIn limit of 10/);
    expect(await page.evaluate(() => (window as unknown as { submitted: string[] }).submitted)).toEqual([]);
    expect(seen.external.map((e) => e.action)).toEqual(["check"]);
    seen.globalStop = false;

    (ctx as unknown as { setLinkedin(h: string): void }).setLinkedin(liPage("<p>Let's do a quick security check</p>"));
    seen.external = [];
    const page2 = await ctx.newPage();
    await page2.goto("https://www.linkedin.com/jobs/search/?f_AL=true");
    await runFilter(popup, page2);
    run = await finished(popup);
    expect(run.stopped).toMatch(/security check/);
    expect(seen.external).toEqual([]);
    (ctx as unknown as { setLinkedin(h: string): void }).setLinkedin(liPage());
  }, 120_000);

  live("refuses to start when Career Agent does not allow it, and on a page that is not a job list", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const popup = await popupPage(ctx);
    seen.allowed = false; seen.external = [];
    await popup.evaluate(() => CA.refresh());
    const page = await ctx.newPage();
    await page.goto("https://www.linkedin.com/jobs/search/?f_AL=true");
    await runFilter(popup, page);
    expect((await finished(popup)).stopped).toMatch(/Auto-Apply is switched off/);
    seen.allowed = true;
    await popup.evaluate(() => CA.refresh());

    const other = await ctx.newPage();
    await other.goto(`${base}/nothing`);
    const tabId = await popup.evaluate(async (u) => Math.max(...(await chrome.tabs.query({ url: u })).map((t) => t.id)), `${base}/*`);
    await popup.evaluate(() => chrome.storage.local.remove("filterRun"));
    await popup.evaluate((id) => chrome.runtime.sendMessage({ type: "run-filter", tabId: id, max: 3 }), tabId);
    expect((await finished(popup)).stopped).toMatch(/Open LinkedIn Jobs/);
    expect(seen.external).toEqual([]);
  }, 60_000);

  live("works through a Naukri list: applies at once, hands back a question it cannot answer, skips company-site and already-applied jobs", async () => {
    expect(ctx, "the browser with the extension must start").toBeDefined();
    if (!ctx) return;
    const popup = await popupPage(ctx);
    await popup.evaluate(() => CA.refresh());
    seen.external = []; seen.globalStop = false; seen.allowed = true;
    const page = await ctx.newPage();
    await page.goto("https://www.naukri.com/jobs-in-singapore");
    await runFilter(popup, page);
    const run = await finished(popup, 120_000);
    const by = Object.fromEntries(run.results.map((r) => [r.id, r]));
    expect(by["111111111111"], JSON.stringify(run)).toMatchObject({ outcome: "submitted" });
    expect(by["222222222222"]).toMatchObject({ outcome: "blocked", why: expect.stringMatching(/Describe your biggest achievement/) });
    expect(by["333333333333"]).toMatchObject({ outcome: "skipped", why: expect.stringMatching(/company's own site/) });
    expect(by["444444444444"]).toMatchObject({ outcome: "skipped", why: expect.stringMatching(/already applied/) });
    expect(seen.external.map((e) => `${e.action}:${e.jobKey}`)).toEqual(["check:111111111111", "submitted:111111111111", "check:222222222222", "needs_input:222222222222"]);
    expect(seen.external[1]).toMatchObject({ portal: "naukri", company: "Acme Pte" });
  }, 150_000);
});

declare const chrome: { storage: { local: { set(o: unknown): Promise<void>; remove(k: string): Promise<void>; get(k: string): Promise<Record<string, any>> } }; runtime: { sendMessage(m: unknown): Promise<unknown> }; tabs: { query(q: unknown): Promise<{ id: number }[]> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
declare const CA: { refresh(): Promise<{ source: string; error?: string }> };
