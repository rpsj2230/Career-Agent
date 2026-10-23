import { spawnSync } from "node:child_process";

/**
 * Keeps the assistant on the newest code, so nobody has to remember `git pull`. It only ever fast-forwards the branch it is on (main) to origin/main, and only when
 * the folder has no local changes: a folder you edited, a different branch, or history that has diverged is left alone and said so. If installing the new
 * dependencies fails, the folder is put back exactly as it was. Used between rounds, never in the middle of an application.
 */
export type Run = (cmd: string, args: string[], cwd: string, timeoutMs?: number) => { code: number; out: string };
export type UpdateResult = { status: "current" | "updated" | "skipped" | "failed"; detail: string; from?: string; to?: string };

export const run: Run = (cmd, args, cwd, timeoutMs = 120_000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

export function selfUpdate(repoDir: string, exec: Run = run, branch = "main"): UpdateResult {
  const git = (...a: string[]) => exec("git", a, repoDir, 60_000);
  const here = git("rev-parse", "--abbrev-ref", "HEAD");
  if (here.code !== 0) return { status: "skipped", detail: "this folder is not a git checkout, so it cannot update itself" };
  if (here.out !== branch) return { status: "skipped", detail: `this folder is on the branch "${here.out}", not ${branch}; it is left alone` };
  if (git("status", "--porcelain", "--untracked-files=no").out) return { status: "skipped", detail: "files in this folder were changed by hand, so it is left alone" };
  const fetched = git("fetch", "--quiet", "origin", branch);
  if (fetched.code !== 0) return { status: "failed", detail: `could not reach GitHub to look for an update (${fetched.out.slice(0, 120)})` };
  const from = git("rev-parse", "HEAD").out, to = git("rev-parse", `origin/${branch}`).out;
  if (!from || !to) return { status: "failed", detail: "could not read the versions" };
  if (from === to) return { status: "current", detail: "already the newest version", from, to };
  if (git("merge-base", "--is-ancestor", from, to).code !== 0) return { status: "skipped", detail: "this folder has commits that are not on GitHub, so it is left alone", from, to };
  const changed = git("diff", "--name-only", from, to).out.split("\n");
  const merged = git("merge", "--ff-only", `origin/${branch}`);
  if (merged.code !== 0) return { status: "failed", detail: `could not move to the newest version (${merged.out.slice(0, 120)})`, from, to };
  if (changed.some((f) => f === "package.json" || f === "package-lock.json")) {
    const install = exec("npm", ["install", "--no-audit", "--no-fund"], repoDir, 600_000);
    if (install.code !== 0) {
      git("reset", "--hard", from); // back to exactly what was running
      return { status: "failed", detail: `the new version needs packages that could not be installed, so the old version was kept (${install.out.slice(-160)})`, from, to };
    }
  }
  return { status: "updated", detail: `updated ${from.slice(0, 7)} to ${to.slice(0, 7)}`, from, to };
}
