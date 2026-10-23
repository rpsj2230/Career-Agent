import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { selfUpdate, type Run } from "../worker/self-update";

const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
let remote = "", work = "", other = "";

/** A real remote, a checkout that is the assistant's folder, and a second checkout that publishes new versions. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ca-upd-"));
  remote = join(root, "remote.git"); work = join(root, "work"); other = join(root, "other");
  mkdirSync(remote); g(remote, "init", "--bare", "-b", "main");
  execFileSync("git", ["clone", "-q", remote, work]); execFileSync("git", ["clone", "-q", remote, other]);
  for (const d of [work, other]) { g(d, "config", "user.email", "t@example.com"); g(d, "config", "user.name", "t"); g(d, "checkout", "-q", "-B", "main"); }
  writeFileSync(join(work, "a.txt"), "1"); writeFileSync(join(work, "package.json"), "{}");
  g(work, "add", "-A"); g(work, "commit", "-q", "-m", "one"); g(work, "push", "-q", "origin", "main");
  g(other, "pull", "-q", "origin", "main");
}
const publish = (file: string, text: string) => { writeFileSync(join(other, file), text); g(other, "add", "-A"); g(other, "commit", "-q", "-m", `change ${file}`); g(other, "push", "-q", "origin", "main"); };

describe("the assistant updating itself", () => {
  beforeEach(setup);

  it("says it is current when there is nothing new", () => {
    expect(selfUpdate(work).status).toBe("current");
  });
  it("moves to the newest version, and installs packages only when the package files changed", () => {
    const calls: string[] = [];
    const spy: Run = (cmd, args, cwd, t) => { if (cmd === "npm") { calls.push(`${cmd} ${args[0]}`); return { code: 0, out: "" }; } return execRun(cmd, args, cwd, t); };
    publish("a.txt", "2");
    const r1 = selfUpdate(work, spy);
    expect(r1.status).toBe("updated");
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("2");
    expect(calls).toEqual([]);
    publish("package.json", '{"x":1}');
    expect(selfUpdate(work, spy).status).toBe("updated");
    expect(calls).toEqual(["npm install"]);
  });
  it("puts the folder back exactly as it was when the packages cannot be installed", () => {
    const before = g(work, "rev-parse", "HEAD");
    publish("package.json", '{"x":2}');
    const failing: Run = (cmd, args, cwd, t) => (cmd === "npm" ? { code: 1, out: "ENOTFOUND registry" } : execRun(cmd, args, cwd, t));
    const r = selfUpdate(work, failing);
    expect(r.status).toBe("failed");
    expect(r.detail).toMatch(/old version was kept/);
    expect(g(work, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(work, "package.json"), "utf8")).toBe("{}");
  });
  it("leaves a folder alone that was edited by hand, is on another branch, or has its own commits", () => {
    publish("a.txt", "3");
    writeFileSync(join(work, "a.txt"), "edited");
    expect(selfUpdate(work)).toMatchObject({ status: "skipped", detail: expect.stringContaining("changed by hand") });
    g(work, "checkout", "-q", "--", "a.txt");
    g(work, "checkout", "-q", "-b", "mine");
    expect(selfUpdate(work)).toMatchObject({ status: "skipped", detail: expect.stringContaining('branch "mine"') });
    g(work, "checkout", "-q", "main");
    writeFileSync(join(work, "b.txt"), "own"); g(work, "add", "-A"); g(work, "commit", "-q", "-m", "mine");
    expect(selfUpdate(work)).toMatchObject({ status: "skipped", detail: expect.stringContaining("not on GitHub") });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("1");
  });
  it("reports, and changes nothing, when GitHub cannot be reached or the folder is not a checkout", () => {
    g(work, "remote", "set-url", "origin", join(tmpdir(), "does-not-exist.git"));
    expect(selfUpdate(work)).toMatchObject({ status: "failed", detail: expect.stringContaining("could not reach GitHub") });
    expect(selfUpdate(mkdtempSync(join(tmpdir(), "ca-nogit-")))).toMatchObject({ status: "skipped" });
  });
});

import { run as execRun } from "../worker/self-update";
