
export type TestStep = { label: string; ok: boolean; detail: string };
type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Checks, step by step, that this site can hand work to GitHub: both variables set, the token valid and allowed to see the repository,
 * and the workflows present and enabled. Each failure says what to change. Nothing is started or changed.
 */
export async function testGithub(env: Record<string, string | undefined> = process.env, doFetch: Fetch = fetch as unknown as Fetch): Promise<{ ok: boolean; steps: TestStep[] }> {
  const steps: TestStep[] = [];
  const repo = env.GITHUB_REPO?.trim(), token = env.GITHUB_DISPATCH_TOKEN?.trim();
  steps.push({ label: "GITHUB_REPO", ok: !!repo && /^[\w.-]+\/[\w.-]+$/.test(repo), detail: repo ? (/^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : `"${repo}" is not in the form owner/repo`) : "Not set in Vercel. Set it to owner/repo, for example rpsj2230/Career-Agent." });
  steps.push({ label: "GITHUB_DISPATCH_TOKEN", ok: !!token, detail: token ? "Set." : "Not set in Vercel. Create a fine-grained GitHub token for this repository only, with Actions: Read and write, and set it." });
  if (!steps.every((s) => s.ok)) return { ok: false, steps };

  const get = async (path: string) => {
    try { return await doFetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10_000) }); }
    catch (e) { return { status: 0, json: async () => ({ message: e instanceof Error ? e.message : String(e) }) }; }
  };
  const why = (status: number, msg: string) => status === 401 ? "GitHub rejected the token (expired or mistyped). Create a new one and update GITHUB_DISPATCH_TOKEN."
    : status === 403 ? "The token is valid but not allowed here. It needs Actions: Read and write on this repository."
    : status === 404 ? "Not found: the repository name is wrong, or the token has no access to this repository."
    : status === 0 ? `Could not reach GitHub (${msg}).` : `GitHub answered ${status}: ${msg}`;

  const r = await get("");
  const rmsg = String(((await r.json().catch(() => ({}))) as { message?: string }).message ?? "");
  steps.push({ label: "Token can see the repository", ok: r.status === 200, detail: r.status === 200 ? "Yes." : why(r.status, rmsg) });
  if (r.status !== 200) return { ok: false, steps };

  for (const file of ["task.yml", "pipeline.yml"]) {
    const w = await get(`/actions/workflows/${file}`);
    const body = (await w.json().catch(() => ({}))) as { state?: string; message?: string };
    const ok = w.status === 200 && body.state === "active";
    steps.push({ label: `Workflow ${file}`, ok, detail: ok ? "Present and enabled." : w.status === 200 ? `Found but ${body.state}. Enable it under GitHub > Actions.` : w.status === 404 ? "Not found on the main branch. Merge the latest code into main." : why(w.status, body.message ?? "") });
  }
  return { ok: steps.every((s) => s.ok), steps };
}
