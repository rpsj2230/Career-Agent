import { describe, expect, it } from "vitest";
import { testGithub } from "@/lib/github-test";

const reply = (status: number, body: unknown = {}) => ({ status, json: async () => body });
const env = { GITHUB_REPO: "me/app", GITHUB_DISPATCH_TOKEN: "tok" };

describe("GitHub connection test", () => {
  it("names the missing variables", async () => {
    const r = await testGithub({}, async () => reply(200));
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.detail).join(" ")).toMatch(/GITHUB_REPO|Not set/);
  });
  it("rejects a malformed repository name", async () => {
    const r = await testGithub({ GITHUB_REPO: "just-a-name", GITHUB_DISPATCH_TOKEN: "t" }, async () => reply(200));
    expect(r.ok).toBe(false);
    expect(r.steps[0].detail).toMatch(/owner\/repo/);
  });
  it("explains a rejected token, a token without access, and a missing repository", async () => {
    expect((await testGithub(env, async () => reply(401))).steps.at(-1)!.detail).toMatch(/expired or mistyped/);
    expect((await testGithub(env, async () => reply(403))).steps.at(-1)!.detail).toMatch(/Actions: Read and write/);
    expect((await testGithub(env, async () => reply(404))).steps.at(-1)!.detail).toMatch(/no access to this repository|name is wrong/);
  });
  it("passes when the token sees the repository and both workflows are active", async () => {
    const calls: string[] = [];
    const r = await testGithub(env, async (url) => { calls.push(url); return reply(200, { state: "active" }); });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["https://api.github.com/repos/me/app", "https://api.github.com/repos/me/app/actions/workflows/task.yml", "https://api.github.com/repos/me/app/actions/workflows/pipeline.yml"]);
  });
  it("flags a disabled or missing workflow", async () => {
    const r = await testGithub(env, async (url) => url.endsWith("task.yml") ? reply(404) : reply(200, { state: "disabled_manually" }));
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.label.includes("task.yml"))!.detail).toMatch(/Merge the latest code into main/);
    expect(r.steps.find((s) => s.label.includes("pipeline.yml"))!.detail).toMatch(/disabled_manually/);
  });
  it("reports a network failure instead of throwing", async () => {
    const r = await testGithub(env, async () => { throw new Error("offline"); });
    expect(r.ok).toBe(false);
    expect(r.steps.at(-1)!.detail).toMatch(/Could not reach GitHub \(offline\)/);
  });
});
