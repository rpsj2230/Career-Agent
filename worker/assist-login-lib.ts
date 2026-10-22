import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The background assistant's process ids: each watcher writes its own to ~/.career-agent/watch*.pid (see assist-lock.ts). Only live processes count. */
export function runningWatchers(home = homedir(), isAlive: (pid: number) => boolean = defaultAlive): number[] {
  const dir = join(home, ".career-agent");
  if (!existsSync(dir)) return [];
  const pids: number[] = [];
  for (const f of readdirSync(dir)) {
    if (!/^watch.*\.pid$/.test(f)) continue;
    const pid = Number(readFileSync(join(dir, f), "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) pids.push(pid);
  }
  return pids;
}

const defaultAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** The Mac launch agents this project installed (scripts/autostart/install.sh), so they can be paused while you sign in and started again. */
export function launchAgentPlists(home = homedir()): string[] {
  const dir = join(home, "Library", "LaunchAgents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^com\.career-agent\.assistant.*\.plist$/.test(f)).map((f) => join(dir, f));
}
