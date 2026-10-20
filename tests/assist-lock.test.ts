import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireWatcherLock, heldByAnother, lockPathFor } from "../worker/assist-lock";

const home = () => mkdtempSync(join(tmpdir(), "lock-"));

describe("one watcher per profile", () => {
  it("names the lock per profile", () => {
    expect(lockPathFor("", "/h")).toBe("/h/.career-agent/watch.pid");
    expect(lockPathFor("priya", "/h")).toBe("/h/.career-agent/watch-priya.pid");
  });
  it("takes the lock when nobody holds it, and releases it", async () => {
    const path = lockPathFor("", home());
    const release = await acquireWatcherLock(path, () => undefined, async () => undefined, 4242);
    expect(readFileSync(path, "utf8")).toBe("4242");
    release();
    expect(existsSync(path)).toBe(false);
  });
  it("ignores a stale lock left by a process that no longer exists", async () => {
    const path = lockPathFor("", home());
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "999999999");
    expect(heldByAnother(path, 1)).toBeNull();
    const release = await acquireWatcherLock(path, () => undefined, async () => undefined, 7);
    expect(readFileSync(path, "utf8")).toBe("7");
    release();
  });
  it("waits while a live process holds it, then takes over when it is gone", async () => {
    const path = lockPathFor("", home());
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, String(process.ppid)); // a running process that is not this one
    const said: string[] = [];
    let naps = 0;
    const release = await acquireWatcherLock(path, (s) => said.push(s), async () => { if (++naps === 2) writeFileSync(path, "999999999"); }, process.pid);
    expect(naps).toBe(2);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("already working");
    expect(readFileSync(path, "utf8")).toBe(String(process.pid));
    release();
  });
});
