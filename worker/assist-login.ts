/**
 * Opens the assistant's own browser window so you can sign in to the job portals once:  npm run assist:login
 * The sessions are kept in a folder on your computer (the same one the assistant uses), so it can open the portals as you later.
 * This program never sees or stores your passwords. Close the browser window when you are finished.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { browserFromMachine } from "./browser";
import { chromium } from "playwright";

const SITES = [
  ["LinkedIn", "https://www.linkedin.com/login"],
  ["Naukri", "https://www.naukri.com/nlogin/login"],
  ["Indeed", "https://secure.indeed.com/auth"],
] as const;

async function main() {
  const profileDir = process.env.ASSIST_PROFILE_DIR || join(homedir(), ".career-agent", "browser");
  mkdirSync(profileDir, { recursive: true });
  const choice = browserFromMachine();
  console.log(`Browser: ${choice.name}. It uses its own profile folder (${profileDir}), not your everyday browser profile.`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false, viewport: null, executablePath: choice.executablePath, channel: choice.channel,
  });
  console.log("A browser window is open with one tab per portal. Sign in to each one you use (solve any security check yourself).");
  console.log("When you are finished, CLOSE THE BROWSER WINDOW. Your sessions are kept for the assistant.");
  const first = context.pages()[0] ?? (await context.newPage());
  await first.goto(SITES[0][1]).catch(() => undefined);
  for (const [, url] of SITES.slice(1)) { const p = await context.newPage(); await p.goto(url).catch(() => undefined); }
  await new Promise<void>((resolve) => { context.on("close", () => resolve()); process.on("SIGINT", () => { void context.close().then(() => resolve()); }); });
  console.log("Saved. You can now run: npm run assist:check");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
