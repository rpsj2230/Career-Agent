/**
 * Which browser the apply assistant drives. By default it uses its own copy of Chromium, in its own profile folder
 * (~/.career-agent/browser), so it never touches your everyday Chrome or Brave and no session stays open in them.
 * To use Brave (or Chrome, Edge) instead, set ASSIST_BROWSER=brave, or write the word into the file ~/.career-agent/browser.conf.
 * The sign-in sessions still live in the assistant's own profile folder, not in your normal browser profile.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserChoice = { executablePath?: string; channel?: string; name: string };

const BRAVE_PATHS: Record<string, string[]> = {
  darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  linux: ["/usr/bin/brave-browser", "/usr/bin/brave", "/opt/brave.com/brave/brave-browser"],
  win32: ["C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe", "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
};

export function chooseBrowser(o: { env: Record<string, string | undefined>; platform: string; exists: (p: string) => boolean; conf?: string }): BrowserChoice {
  if (o.env.CHROMIUM_PATH) return { executablePath: o.env.CHROMIUM_PATH, name: o.env.CHROMIUM_PATH };
  if (o.env.ASSIST_CHANNEL) return { channel: o.env.ASSIST_CHANNEL, name: o.env.ASSIST_CHANNEL };
  const want = (o.env.ASSIST_BROWSER || o.conf || "").trim();
  const key = want.toLowerCase();
  if (!want || key === "chromium" || key === "default") return { name: "the assistant's own Chromium" };
  if (key === "chrome") return { channel: "chrome", name: "Google Chrome" };
  if (key === "edge") return { channel: "msedge", name: "Microsoft Edge" };
  if (key === "brave") {
    const found = (BRAVE_PATHS[o.platform] ?? []).find((p) => o.exists(p));
    if (!found) throw new Error("Brave was chosen as the assistant's browser but was not found. Install it from https://brave.com or remove the setting (delete ~/.career-agent/browser.conf and unset ASSIST_BROWSER).");
    return { executablePath: found, name: "Brave" };
  }
  if (o.exists(want)) return { executablePath: want, name: want };
  throw new Error(`The assistant's browser setting "${want}" is not recognised. Use brave, chrome, edge, chromium, or the full path to a Chromium-based browser.`);
}

export function browserFromMachine(): BrowserChoice {
  let conf: string | undefined;
  try { conf = readFileSync(join(homedir(), ".career-agent", "browser.conf"), "utf8").split("\n")[0]; } catch { /* not set */ }
  return chooseBrowser({ env: process.env, platform: process.platform, exists: existsSync, conf });
}

/**
 * Naukri's servers sometimes drop the newer HTTP/2 connection from the assistant's browser ("ERR_HTTP2_PROTOCOL_ERROR", "This site can't be reached").
 * Asking for plain HTTP/1.1 makes those pages load. It changes only the network protocol, nothing about how the window presents itself.
 */
export const PLAIN_HTTP: { args: string[] } = { args: ["--disable-http2"] };
