/**
 * Saves the sign-ins of the assistant's browser on your computer to one file, so a worker on another machine can use the same sessions:
 *   npm run assist:export        (then copy the file it names to the other machine; the setup guide shows the command)
 * The file is as sensitive as a password: it is written readable only by you. Delete it after copying.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { asAssistantProfile, browserDirFor, type Who } from "./assist-profile";
import { browserFromMachine, LEAN_BROWSER } from "./browser";
import { chromium } from "playwright";

async function main(who: Who | null) {
  const out = join(homedir(), ".career-agent", "assist-state.json");
  mkdirSync(dirname(out), { recursive: true });
  const choice = browserFromMachine();
  const context = await chromium.launchPersistentContext(browserDirFor(who), { headless: true, executablePath: choice.executablePath, channel: choice.channel, ...LEAN_BROWSER });
  await context.storageState({ path: out });
  await context.close();
  chmodSync(out, 0o600);
  console.log(`Saved the sign-ins to ${out}`);
  console.log("Copy it to the other machine (replace USER and HOST):");
  console.log(`  scp ${out} USER@HOST:~/assist-state.json`);
  console.log("Then delete it here:  rm " + out);
}

asAssistantProfile((who) => main(who)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
