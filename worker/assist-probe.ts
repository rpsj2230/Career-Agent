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
import { EASY_APPLY_SCOPE, linkedinOpenApply, waitForLinkedinApply } from "./assist-lib";
import { launchAgentPlists, runningWatchers, type Outline } from "./assist-login-lib";

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
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront().catch(() => undefined);
    console.log(`The ${choice.name} window is open: watch it. Opening the job...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await waitForLinkedinApply(page);
    const opened = await linkedinOpenApply(context, page);
    await sleep(3500);
    const target = opened.page;
    const dump = await target.evaluate((scopeSel) => {
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const short = (t: string | null | undefined, n = 60) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
      const cls = (e: Element) => short(typeof (e as HTMLElement).className === "string" ? (e as HTMLElement).className : "", 80).split(" ").slice(0, 4).join(" ");
      const labelOf = (e: HTMLInputElement) => short(e.getAttribute("aria-label") || (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : "") || e.closest("label")?.textContent || e.getAttribute("placeholder") || "");
      const outline = (e: Element): Outline => { const i = e as HTMLInputElement; return { tag: e.tagName.toLowerCase(), role: e.getAttribute("role") ?? undefined, type: i.type || undefined, name: i.name || undefined, id: short(e.id, 40) || undefined, aria: short(e.getAttribute("aria-label")) || undefined, label: labelOf(i) || undefined, cls: cls(e) || undefined, required: i.required || undefined }; };
      const containers = [...document.querySelectorAll(`${scopeSel}, main, [aria-modal], [role=dialog]`)].filter(vis).slice(0, 8).map((c) => ({ ...outline(c), visibleControls: c.querySelectorAll("input, select, textarea, button, a[href]").length }));
      const scope = document.querySelector(scopeSel) ?? document.querySelector("main") ?? document.body;
      const controls = [...scope.querySelectorAll("input, select, textarea, button, a[href], [role=button]")].filter(vis).slice(0, 80).map((e) => ({ ...outline(e), text: short(e.textContent, 40) }));
      return { url: location.href.replace(/[?#].*$/, ""), title: short(document.title, 80), containers, controls };
    }, EASY_APPLY_SCOPE) as unknown;
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
    await new Promise<void>((resolve) => { context.on("close", () => resolve()); process.on("SIGINT", () => { void context.close().then(() => resolve()); }); });
  } finally { resume(); }
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
