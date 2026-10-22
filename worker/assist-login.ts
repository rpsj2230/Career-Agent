/**
 * Opens the assistant's own browser window so you can sign in to the job portals once:  npm run assist:login
 * The sessions are kept in a folder on your computer (the same one the assistant uses), so it can open the portals as you later.
 * This program never sees or stores your passwords. Close the browser window when you are finished.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { browserFromMachine, PLAIN_HTTP } from "./browser";
import { chromium } from "playwright";
import { launchAgentPlists, runningWatchers } from "./assist-login-lib";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = (cmd: string, args: string[]) => { try { execFileSync(cmd, args, { stdio: "ignore" }); } catch { /* not running, or already gone */ } };

const SITES = [
  ["LinkedIn", "https://www.linkedin.com/login"],
  ["Naukri", "https://www.naukri.com/nlogin/login"],
  ["Indeed", "https://secure.indeed.com/auth"],
] as const;

async function main(who: Who | null) {
  const profileDir = browserDirFor(who);
  if (who) console.log(`Signing in for: ${who.name}. Use THEIR LinkedIn, Naukri and Indeed accounts in this window.`);
  mkdirSync(profileDir, { recursive: true });
  // The background assistant keeps this same browser profile open while it works. Two browsers cannot share one profile folder, so the sign-in window
  // would never appear (or would open inside the hidden one). Pause the background assistant while you sign in; it is started again afterwards.
  const paused: string[] = [];
  const watchers = runningWatchers();
  if (watchers.length) {
    console.log(`The background assistant is running (process ${watchers.join(", ")}) and uses the same browser profile. It is paused while you sign in and started again afterwards.`);
    if (process.platform === "darwin") for (const plist of launchAgentPlists()) { quiet("launchctl", ["unload", plist]); paused.push(plist); }
    else console.log("(Not a Mac: stop it yourself first, for example: systemctl --user stop career-agent-assistant)");
    for (let i = 0; i < 10 && runningWatchers().length; i++) await sleep(1000);
  }
  // a browser left over from a stopped round would still hold the profile: close only the ones using THIS profile folder
  if (process.platform !== "win32") quiet("pkill", ["-f", "--", `--user-data-dir=${profileDir}`]);
  await sleep(500);
  const resume = () => { for (const plist of paused.splice(0)) quiet("launchctl", ["load", plist]); };
  process.on("exit", resume);
  const choice = browserFromMachine();
  console.log(`Browser: ${choice.name}. It uses its own profile folder (${profileDir}), not your everyday browser profile.`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false, viewport: null, executablePath: choice.executablePath, channel: choice.channel, ...PLAIN_HTTP,
  });
  console.log("A browser window is open with one tab per portal. Sign in to each one you use (solve any security check yourself).");
  console.log("When you are finished, CLOSE THE BROWSER WINDOW. Your sessions are kept for the assistant.");
  const first = context.pages()[0] ?? (await context.newPage());
  await first.goto(SITES[0][1]).catch(() => undefined);
  await first.bringToFront().catch(() => undefined);
  console.log(`If you do not see the window, look for the ${choice.name} icon in the Dock (or press Cmd+Tab) and click it.`);
  for (const [, url] of SITES.slice(1)) { const p = await context.newPage(); await p.goto(url).catch(() => undefined); }
  await new Promise<void>((resolve) => { context.on("close", () => resolve()); process.on("SIGINT", () => { void context.close().then(() => resolve()); }); });
  resume();
  console.log("Saved. The background assistant is running again. You can now run: npm run assist:check");
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
