/**
 * The health of the automatic pipeline as a list of plain checks, each with what is wrong and exactly how to fix it.
 * Pure (no database, no network) so every rule is tested; src/lib/automation-health.ts gathers the facts.
 */
export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { id: string; label: string; status: CheckStatus; detail: string; fix?: string };

export type HealthInput = {
  now: Date;
  /** when the hourly GitHub check last reached the app */
  tickAt: string | null;
  schedules: { name: string; enabled: boolean; paused: boolean; next_run_at: string | null }[];
  lastPipeline: { status: string; started_at: string; finished_at: string | null; error: string | null } | null;
  models: { usable: number; message: string | null };
  /** GITHUB_REPO and GITHUB_DISPATCH_TOKEN are both set on the app */
  dispatchConfigured: boolean;
  profileReady: boolean;
  titles: number;
  countries: number;
  newJobs: number;
  queuedJobs: number;
  autoApply: boolean;
};

const HOUR = 3_600_000;
export const ago = (iso: string | null, now: Date): string => {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  return m < 2 ? "just now" : m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function evaluateHealth(i: HealthInput): Check[] {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);

  // 1. the hourly clock reaches the app (proves APP_URL and CRON_SECRET in GitHub are right)
  if (!i.tickAt) add({ id: "tick", label: "Hourly GitHub check", status: "fail", detail: "It has not reached the app yet.", fix: "In GitHub: Settings > Secrets and variables > Actions, set APP_URL (your site address, no trailing slash) and CRON_SECRET (the same value as in Vercel). Then Actions > Scheduled pipeline > Run workflow." });
  else {
    const age = i.now.getTime() - new Date(i.tickAt).getTime();
    if (age > 26 * HOUR) add({ id: "tick", label: "Hourly GitHub check", status: "fail", detail: `Last reached the app ${ago(i.tickAt, i.now)}.`, fix: "Open GitHub > Actions > Scheduled pipeline and look at the latest run. If it is missing, run it by hand once (Run workflow); GitHub pauses scheduled workflows in repositories with no activity." });
    else if (age > 6 * HOUR) add({ id: "tick", label: "Hourly GitHub check", status: "warn", detail: `Last reached the app ${ago(i.tickAt, i.now)}. GitHub sometimes runs scheduled checks late, so schedules may start late.`, fix: "Nothing to do unless this keeps growing; the daily backup check also starts overdue schedules." });
    else add({ id: "tick", label: "Hourly GitHub check", status: "ok", detail: `Last reached the app ${ago(i.tickAt, i.now)}.` });
  }

  // 2. something is scheduled
  const active = i.schedules.filter((s) => s.enabled && !s.paused);
  if (i.schedules.length === 0) add({ id: "schedule", label: "Schedule", status: "fail", detail: "There is no schedule, so nothing runs by itself.", fix: "Open Schedules and press Create the recommended schedule (it is also created automatically by the next hourly check)." });
  else if (active.length === 0) add({ id: "schedule", label: "Schedule", status: "fail", detail: "Every schedule is switched off or paused.", fix: "Open Schedules and switch one on or resume it." });
  else {
    const next = active.map((s) => s.next_run_at).filter((x): x is string => !!x).sort()[0] ?? null;
    const overdue = next ? i.now.getTime() - new Date(next).getTime() : 0;
    add(overdue > 6 * HOUR
      ? { id: "schedule", label: "Schedule", status: "warn", detail: `"${active[0].name}" was due ${ago(next, i.now)} and has not started.`, fix: "Check the hourly check above; you can also press Run now on the Schedules page." }
      : { id: "schedule", label: "Schedule", status: "ok", detail: `${active.length} active. Next run: ${next ? new Date(next).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "at the next hourly check"}.` });
  }

  // 3. models can be used by the runner
  add(i.models.usable > 0
    ? { id: "models", label: "AI models", status: "ok", detail: `${i.models.usable} model(s) have a usable key.` }
    : { id: "models", label: "AI models", status: "fail", detail: i.models.message ?? "No model has a usable key, so jobs cannot be scored or tailored.", fix: "Models page: add a key for at least one model and press Test." });

  // 4. buttons can hand work to GitHub (avoids the host's 60-second limit)
  add(i.dispatchConfigured
    ? { id: "dispatch", label: "Background runs from the site", status: "ok", detail: "Find, score and prepare run in GitHub (no time limit) when you press their buttons." }
    : { id: "dispatch", label: "Background runs from the site", status: "warn", detail: "GITHUB_REPO and GITHUB_DISPATCH_TOKEN are not both set in Vercel, so buttons run a short version inside the site's 60-second limit.", fix: "Vercel > Project > Settings > Environment Variables: GITHUB_REPO = rpsj2230/Career-Agent and GITHUB_DISPATCH_TOKEN = a GitHub token (fine-grained, this repository only, Actions: Read and write). Redeploy." });

  // 5. the last scheduled run
  if (!i.lastPipeline) add({ id: "run", label: "Last scheduled run", status: "warn", detail: "No scheduled run has finished yet.", fix: "It starts at the next hourly check, or press Run now on the Schedules page." });
  else {
    const p = i.lastPipeline;
    const base = `${p.status}, started ${ago(p.started_at, i.now)}`;
    add(p.status === "failed" ? { id: "run", label: "Last scheduled run", status: "fail", detail: `${base}. ${p.error ?? ""}`.trim(), fix: "Open Logs > Runs for the reason." }
      : p.status === "running" && i.now.getTime() - new Date(p.started_at).getTime() > 90 * 60_000 ? { id: "run", label: "Last scheduled run", status: "warn", detail: `${base} and still marked running; it probably stopped.`, fix: "It is cleared automatically at the next hourly check." }
      : p.status === "partial" ? { id: "run", label: "Last scheduled run", status: "warn", detail: `${base}. ${p.error ?? "Some steps were incomplete."}`.trim(), fix: "Open Logs > Runs for what was left." }
      : { id: "run", label: "Last scheduled run", status: "ok", detail: base + "." });
  }

  // 6. the inputs it searches with
  const missing = [!i.profileReady && "a confirmed profile", i.titles === 0 && "target roles", i.countries === 0 && "a country"].filter(Boolean);
  add(missing.length
    ? { id: "setup", label: "What to search", status: "fail", detail: `Missing: ${missing.join(", ")}.`, fix: "Profile page: import and confirm your profile; target roles are on the same page; countries are on the Countries page." }
    : { id: "setup", label: "What to search", status: "ok", detail: `${i.titles} role(s) in ${i.countries} country(ies).` });

  // 7. information
  if (i.newJobs > 0) add({ id: "backlog", label: "Waiting to be scored", status: i.models.usable > 0 ? "ok" : "warn", detail: `${i.newJobs} new job(s) are waiting to be scored (Review queue > Not scored yet). The next scheduled run scores them; or press Score new jobs.` });
  add({ id: "autoapply", label: "Auto-Apply", status: "ok", detail: i.autoApply ? "On: schedules may submit within your limits." : "Off: applications wait for your approval (Applications page). Switch on in Settings if you want it." });
  return out;
}

export const worst = (checks: Check[]): CheckStatus => (checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok");
