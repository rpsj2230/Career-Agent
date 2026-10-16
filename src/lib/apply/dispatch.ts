import "server-only";

/** Start the Playwright worker (GitHub Actions workflow_dispatch). Returns an error message or null. */
export async function dispatchApply(applicationId: string): Promise<string | null> {
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!repo || !token) return "GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set: worker not started";
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/apply.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "main", inputs: { application_id: applicationId } }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? null : `GitHub dispatch failed: ${res.status} ${(await res.text()).slice(0, 200)}`;
}
