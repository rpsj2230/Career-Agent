/**
 * Records what a LinkedIn job page looks like after the assistant presses its apply button:  npm run assist:probe -- <LinkedIn job address>
 * It opens the job in the assistant's own (signed-in) browser, presses Easy Apply or "Apply on company website" exactly as the assistant does, and
 * writes the page's STRUCTURE (windows, buttons, the names of the form questions) to ~/.career-agent/probe/. No typed values are recorded, nothing is
 * sent to any employer, and it never presses the button that sends an application. Paste the printed result to get the assistant fixed against the real page.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { browserFromMachine, LEAN_BROWSER } from "./browser";
import { describePage, EASY_APPLY_SCOPE, linkedinOpenApply, waitForLinkedinApply } from "./assist-lib";
import { launchAgentPlists, runningWatchers } from "./assist-login-lib";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = (cmd: string, args: string[]) => { try { execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* not running */ } };

async function main(who: Who | null) {
  const url = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
  if (!url) { console.error("Usage: npm run assist:probe -- https://www.linkedin.com/jobs/view/<number>"); process.exit(1); }
  const profileDir = browserDirFor(who);
  const paused: string[] = [];
  if (runningWatchers().length) {
    console.log("Pausing the background assistant while the probe runs (it starts again afterwards).");
    if (process.platform === "darwin") for (const plist of launchAgentPlists()) { quiet("launchctl", ["unload", plist]); paused.push(plist); }
    for (let i = 0; i < 10 && runningWatchers().length; i++) await sleep(1000);
  }
  if (process.platform !== "win32") quiet("pkill", ["-f", "--", `--user-data-dir=${profileDir}`]);
  await sleep(500);
  const resume = () => { for (const plist of paused.splice(0)) quiet("launchctl", ["load", plist]); };
  process.on("exit", resume);

  const choice = browserFromMachine();
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, executablePath: choice.executablePath, channel: choice.channel, ...LEAN_BROWSER });
  // the page-reading code below is compiled by tsx, which adds a helper the browser does not have: define it, as the assistant does
  await context.addInitScript({ content: "window.__name = window.__name || function (t) { return t; };" });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront().catch(() => undefined);
    console.log(`The ${choice.name} window is open: watch it. Opening the job...`);
    try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForLinkedinApply(page);
    const opened = await linkedinOpenApply(context, page);
    await sleep(3500);
    const target = opened.page;
    const dump = await describePage(target, EASY_APPLY_SCOPE);
    const dir = join(homedir(), ".career-agent", "probe");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = join(dir, `${stamp}.png`);
    await target.screenshot({ path: shot }).catch(() => undefined);
    const text = JSON.stringify({ openedBy: opened.note, kind: opened.kind, page: dump }, null, 1);
    writeFileSync(join(dir, `${stamp}.json`), text);
    console.log("\n===== PASTE EVERYTHING BETWEEN THESE LINES =====");
    console.log(text);
    console.log("===== END =====");
    console.log(`\nAlso saved: ${shot}  (a picture of the page now; send it if you like). Close the browser window to finish.`);
    } catch (e) {
      console.error("\n===== THE PROBE HIT AN ERROR: paste these lines =====");
      console.error(e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}` : String(e));
      console.error("===== END =====\nThe window stays open: close it to finish.");
    }
    await new Promise<void>((resolve) => { context.on("close", () => resolve()); process.on("SIGINT", () => { void context.close().then(() => resolve()); }); });
  } finally { resume(); }
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
