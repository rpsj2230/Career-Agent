/**
 * Every limit that decides how many resumes are written and how many applications are sent, in one list with plain words,
 * what each one counts, where to change it, and what actually happened in the last 24 hours.
 */
export type LimitsInput = {
  autoPrepare: { enabled: boolean; per_run: number; concurrency: number };
  schedules: { name: string; describe: string; mode: "scan" | "scan_prepare" | "scan_prepare_apply"; max_prepare: number; max_apply: number; require_approval: boolean; enabled: boolean; paused: boolean }[];
  caps: { daily_total: number; daily_linkedin: number; weekly_linkedin: number; local_auto_enabled: boolean; company_cooldown_days: number };
  autoApplyOn: boolean;
  waitingForResume: number;
  /** from Settings: how old a posting may be, how soon the same search may repeat, the minimum fit score to match */
  discovery: { max_age_days: number; min_rescan_hours: number };
  scoring: { threshold: number; min_evidence: number };
  last24h: { found: number; scored: number; matched: number; prepared: number; sentAutomatically: number };
  waitingForScore: number;
};

export type LimitRow = { group: "Find" | "Score" | "Match" | "Resumes" | "Sending"; what: string; limit: string; where: { label: string; href: string }; now?: string };

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

export function limitsOverview(i: LimitsInput): LimitRow[] {
  const rows: LimitRow[] = [];
  rows.push({ group: "Find", what: "Jobs found per run", limit: `no total limit. Each search (one job title in one place on one source) brings back the newest postings, about 30 from Adzuna and about 10 from JSearch. The number of searches is job titles x locations x sources, shown on each country card. Only postings from the last ${n(i.discovery.max_age_days, "day")} are kept, and the same search is not repeated within ${n(i.discovery.min_rescan_hours, "hour")}.`, where: { label: "Countries, and Settings → Discovery", href: "/countries" }, now: `${i.last24h.found} found` });
  rows.push({ group: "Score", what: "Jobs scored per run", limit: `every job found is scored, about 60 at a time in up to 8 passes per run, and catch-up rounds carry on with any left over (${n(i.waitingForScore, "job")} waiting now). Jobs the free rules rate under ${i.scoring.min_evidence} are dropped without using an AI model. There is no daily limit of its own; the AI models' free daily allowance is the ceiling.`, where: { label: "Models", href: "/models" }, now: `${i.last24h.scored} scored` });
  rows.push({ group: "Match", what: "Jobs that match", limit: `a fit score of ${i.scoring.threshold} or more out of 100 matches. There is no limit on how many match; the score decides.`, where: { label: "Settings → Scoring", href: "/settings" }, now: `${i.last24h.matched} matched` });
  const live = i.schedules.filter((s) => s.enabled && !s.paused);
  const preparing = live.filter((s) => s.mode !== "scan");
  for (const s of preparing) rows.push({ group: "Resumes", what: `Schedule "${s.name}"`, limit: `writes up to ${n(s.max_prepare, "resume")} each time it runs (${s.describe})`, where: { label: "Schedules", href: "/schedules" } });
  if (preparing.length === 0) rows.push({ group: "Resumes", what: "Schedules", limit: "no schedule writes resumes (none is switched on, or they only search and score)", where: { label: "Schedules", href: "/schedules" } });
  rows.push(i.autoPrepare.enabled && i.autoPrepare.per_run > 0
    ? { group: "Resumes", what: "Catch-up rounds", limit: `write up to ${n(i.autoPrepare.per_run, "resume")} per round, ${i.autoPrepare.concurrency} at a time, and start another round as soon as one ends, until nothing is waiting. They have no daily limit of their own; the free AI models' daily allowance is the ceiling. ${n(i.waitingForResume, "match", "matches")} waiting now.`, where: { label: "Settings → Automatic preparing", href: "/settings" } }
    : { group: "Resumes", what: "Catch-up rounds", limit: "switched off: only schedules and your own Prepare button write resumes", where: { label: "Settings → Automatic preparing", href: "/settings" } });
  rows.push({ group: "Resumes", what: "Resumes written in the last 24 hours", limit: "schedules and catch-up rounds together", where: { label: "Applications", href: "/applications" }, now: String(i.last24h.prepared) });

  const applying = live.filter((s) => s.mode === "scan_prepare_apply");
  const askFirst = applying.length > 0 && applying.every((s) => s.require_approval);
  // two things must both allow it: the global Auto-Apply switch, and a schedule that is set to apply and not to ask first
  const approval = !i.autoApplyOn ? "Auto-Apply is off in Settings, so nothing is approved by itself. Your own Approve clicks always work."
    : applying.length === 0 ? "Auto-Apply is on in Settings, but no schedule is set to \"Find, score, prepare, and apply\", so every application still waits for you. The switch in Settings only gives permission; a schedule has to be set to apply."
    : askFirst ? "Auto-Apply is on and a schedule applies, but it is set to \"Ask me before submitting\", so every application still waits for you."
    : "Auto-Apply is on and a schedule applies without asking: what the rules allow is approved by itself.";
  rows.push({ group: "Sending", what: "Approval (both must allow it)", limit: approval, where: { label: "Settings → Auto-Apply, and Schedules", href: "/schedules" } });
  for (const s of applying) rows.push({ group: "Sending", what: `Schedule "${s.name}"`, limit: `approves and submits up to ${n(s.max_apply, "application")} each time it runs`, where: { label: "Schedules", href: "/schedules" } });
  rows.push({ group: "Sending", what: "Automatic submissions per day (all portals)", limit: `at most ${i.caps.daily_total}; the rest wait until tomorrow or for your manual approval`, where: { label: "Settings → Application limits", href: "/settings" }, now: `${i.last24h.sentAutomatically} of ${i.caps.daily_total}` });
  rows.push({ group: "Sending", what: "LinkedIn", limit: `at most ${i.caps.daily_linkedin} a day and ${i.caps.weekly_linkedin} a week`, where: { label: "Settings → Application limits", href: "/settings" } });
  rows.push({ group: "Sending", what: "Hands-free on your computer", limit: i.caps.local_auto_enabled ? "on: the assistant presses Submit itself, within the limits above" : "off: the assistant fills each form and waits for you to press Submit", where: { label: "Settings → Application limits", href: "/settings" } });
  rows.push({ group: "Sending", what: "Same company", limit: i.caps.company_cooldown_days > 0 ? `automatic approval waits ${n(i.caps.company_cooldown_days, "day")} after an application to the same company` : "no wait between applications to the same company", where: { label: "Settings → Application limits", href: "/settings" } });
  return rows;
}
