import { execFile, execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const has = existsSync("/bin/bash");
const d = describe.skipIf(!has);
let server: Server, url = "", reply = "12";
let project = "", bin = "";

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), "ca-lm-"));
  mkdirSync(join(project, "scripts"));
  copyFileSync("scripts/setup-local-model.sh", join(project, "scripts/setup-local-model.sh"));
  bin = join(project, "bin"); mkdirSync(bin);
  // a stand-in for the ollama program: says it is installed, lists the model as downloaded
  writeFileSync(join(bin, "ollama"), '#!/bin/sh\ncase "$1" in --version) echo "ollama version 0.0.0";; list) printf "NAME ID SIZE\\nqwen2.5:3b-instruct abc 2GB\\n";; pull) exit 0;; esac\n');
  chmodSync(join(bin, "ollama"), 0o755);
  await new Promise<void>((ok) => { server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(req.url?.includes("/api/tags") ? "{}" : JSON.stringify({ choices: [{ message: { content: reply } }] }));
  }).listen(0, "127.0.0.1", () => { url = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }); });
});
afterAll(() => { server?.close(); });

/** async on purpose: the stand-in model server lives in this process, so it must be free to answer while the script runs */
const exec = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<{ status: number; stdout: string }>((ok) => {
  execFile(cmd, args, { env, encoding: "utf8", timeout: 60_000 }, (err, stdout) => ok({ status: err ? ((err as { code?: number }).code ?? 1) : 0, stdout }));
});
const run = (...args: string[]) => exec("bash", [join(project, "scripts/setup-local-model.sh"), ...args], { ...process.env, PATH: `${bin}:${process.env.PATH}`, OLLAMA_URL: url });

d("scripts/setup-local-model.sh", () => {
  it("is valid shell", () => { expect(() => execFileSync("bash", ["-n", "scripts/setup-local-model.sh"])).not.toThrow(); });
  it("writes LOCAL_MODEL once (in place on a second run) and says WORKING when the model answers with a number", async () => {
    writeFileSync(join(project, ".env.local"), "SUPABASE_URL=x");
    const a = await run("qwen2.5:3b-instruct");
    expect(a.stdout).toMatch(/WORKING: qwen2\.5:3b-instruct answered "12"/);
    expect(readFileSync(join(project, ".env.local"), "utf8")).toBe("SUPABASE_URL=x\nLOCAL_MODEL=qwen2.5:3b-instruct\n");
    await run("qwen2.5:3b-instruct");
    expect(readFileSync(join(project, ".env.local"), "utf8").match(/LOCAL_MODEL=/g)).toHaveLength(1);
  });
  it("says NOT WORKING, with the reason, when the model answers nonsense", async () => {
    reply = "I cannot help with that";
    const r = await run("qwen2.5:3b-instruct");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/NOT WORKING: qwen2\.5:3b-instruct answered, but not sensibly/);
    reply = "12";
  });
  it("says NOT WORKING when Ollama is not installed", async () => {
    const r = await exec("/bin/bash", [join(project, "scripts/setup-local-model.sh")], { PATH: "/usr/bin:/bin", OLLAMA_URL: url, HOME: project } as unknown as NodeJS.ProcessEnv);
    // only if the machine running the test has no ollama of its own
    if (!existsSync("/usr/bin/ollama") && !existsSync("/bin/ollama")) { expect(r.status).toBe(1); expect(r.stdout).toMatch(/NOT WORKING: Ollama is not installed/); }
  });
});
