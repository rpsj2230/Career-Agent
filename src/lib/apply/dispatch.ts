import "server-only";
import { profileInContext, PROFILE_HEADER, UUID } from "@/lib/profile-context";
import { profilesEnabled } from "@/lib/scope";
import { rawClient } from "@/lib/raw-client";

/** The profile the button was pressed in, for workflows that act for one person. */
async function profileForTask(): Promise<string | null> {
  if (!(await profilesEnabled(rawClient()))) return null;
  const inCtx = profileInContext();
  if (inCtx) return inCtx;
  try {
    const { headers } = await import("next/headers");
    const v = (await headers()).get(PROFILE_HEADER);
    return v && UUID.test(v) ? v : null;
  } catch { return null; }
}

/** Start a GitHub Actions workflow (workflow_dispatch). Returns an error message or null. */
export async function dispatchWorkflow(file: string, inputs: Record<string, string>): Promise<string | null> {
  const repo = process.env.GITHUB_REPO; // "owner/repo"
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!repo || !token) return "GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set: worker not started";
  if (file === "task.yml" && inputs.task !== "localtest" && !inputs.profile_id) {
    const pid = await profileForTask();
    if (pid) inputs = { ...inputs, profile_id: pid };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "main", inputs }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? null : `GitHub dispatch failed: ${res.status} ${(await res.text()).slice(0, 200)}`;
}

/** Start the Playwright worker for one approved application. */
export const dispatchApply = (applicationId: string) => dispatchWorkflow("apply.yml", { application_id: applicationId });

export const workerConfigured = () => !!process.env.GITHUB_REPO && !!process.env.GITHUB_DISPATCH_TOKEN;
