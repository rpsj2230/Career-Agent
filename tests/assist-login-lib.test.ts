import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchAgentPlists, runningWatchers } from "../worker/assist-login-lib";

const home = () => mkdtempSync(join(tmpdir(), "login-lib-"));

describe("finding the background assistant", () => {
  it("lists only watchers whose process is alive", () => {
    const h = home();
    mkdirSync(join(h, ".career-agent"), { recursive: true });
    writeFileSync(join(h, ".career-agent", "watch.pid"), "111");
    writeFileSync(join(h, ".career-agent", "watch-priya.pid"), "222");
    writeFileSync(join(h, ".career-agent", "other.pid"), "333");
    writeFileSync(join(h, ".career-agent", "watch-bad.pid"), "not a number");
    expect(runningWatchers(h, (pid) => pid === 111)).toEqual([111]);
    expect(runningWatchers(h, () => true).sort()).toEqual([111, 222]);
    expect(runningWatchers(h, () => false)).toEqual([]);
  });
  it("copes with no folder at all", () => { expect(runningWatchers(home())).toEqual([]); });
  it("finds this project's launch agents and nothing else", () => {
    const h = home();
    const dir = join(h, "Library", "LaunchAgents");
    mkdirSync(dir, { recursive: true });
    for (const f of ["com.career-agent.assistant.plist", "com.career-agent.assistant-priya.plist", "com.apple.thing.plist"]) writeFileSync(join(dir, f), "<plist/>");
    expect(launchAgentPlists(h).map((p) => p.split("/").pop()).sort()).toEqual(["com.career-agent.assistant-priya.plist", "com.career-agent.assistant.plist"]);
    expect(launchAgentPlists(home())).toEqual([]);
  });
});
