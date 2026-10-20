import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the watcher for one profile records its process id, so a second copy can see that one is already working. */
export const lockPathFor = (slug: string, home = homedir()) => join(home, ".career-agent", `watch${slug ? `-${slug}` : ""}.pid`);

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** True when another watcher (a different, running process) holds the lock. */
export function heldByAnother(path: string, me = process.pid): number | null {
  if (!existsSync(path)) return null;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && pid !== me && alive(pid) ? pid : null;
}

/**
 * Only one watcher per profile may drive the browser. A second copy (started by hand while the autostart one is running, or after a
 * reload) would double the memory and processor use and could submit the same application twice, so it waits quietly and takes over
 * if the first one stops.
 */
export async function acquireWatcherLock(path: string, log: (s: string) => void, sleep: (ms: number) => Promise<void>, me = process.pid): Promise<() => void> {
  let told = false;
  for (let other = heldByAnother(path, me); other !== null; other = heldByAnother(path, me)) {
    if (!told) { log(`Another assistant (process ${other}) is already working for this profile. This copy waits and takes over if it stops. To stop the other one: kill ${other}`); told = true; }
    await sleep(30_000);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(me));
  return () => { try { if (readFileSync(path, "utf8").trim() === String(me)) unlinkSync(path); } catch { /* already gone */ } };
}
