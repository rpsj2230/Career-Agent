/**
 * The pipeline in one table: for each step, what happened in the last 24 hours, what is waiting now, and the limit that applies.
 * Pure (no database), so every sentence is tested; src/lib/pipeline-table-store.ts reads the numbers.
 */
export type TableInput = {
  /** null when a number could not be read: shown as "?", never as a believable 0 */
  last24h: { found: number | null; scored: number | null; matched: number | null; prepared: number | null; approved: number | null; sent: number | null };
  waiting: { toScore: number | null; toPrepare: number | null; toApprove: number | null; toSend: number | null; needsYou: number | null };
  autoPrepare: { enabled: boolean; per_run: number; concurrency: number };
  schedules: { name: string; mode: "scan" | "scan_prepare" | "scan_prepare_apply"; max_prepare: number; max_apply: number; require_approval: boolean; enabled: boolean; paused: boolean }[];
  caps: { daily_total: number; daily_linkedin: number; weekly_linkedin: number; local_auto_enabled: boolean; company_cooldown_days: number };
  autoApplyOn: boolean;
  sentAutomaticallyToday: number;
  discovery: { max_age_days: number; min_rescan_hours: number };
  scoring: { threshold: number };
};

export type TableRow = { step: string; question: string; last24h: number | null; /** undefined: the step has no queue; null: the number could not be read */ waiting: number | null | undefined; limit: string; link: { label: string; href: string } };

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** One sentence on whether applications are approved by themselves, which depends on two settings together. */
export function approvalRule(i: Pick<TableInput, "autoApplyOn" | "schedules">): string {
  const applying = i.schedules.filter((s) => s.enabled && !s.paused && s.mode === "scan_prepare_apply");
  if (!i.autoApplyOn) return "Auto-Apply is off in Settings, so nothing is approved by itself (your own Approve clicks always work).";
  if (applying.length === 0) return "Auto-Apply is on, but no schedule is set to apply, so every application waits for you.";
  if (applying.every((s) => s.require_approval)) return "Auto-Apply is on, but the schedule is set to ask before submitting, so every application waits for you.";
  return "Auto-Apply is on and a schedule applies without asking: what the rules allow is approved by itself.";
}

export function pipelineTable(i: TableInput): TableRow[] {
  const live = i.schedules.filter((s) => s.enabled && !s.paused);
  const preparing = live.filter((s) => s.mode !== "scan");
  const applying = live.filter((s) => s.mode === "scan_prepare_apply");
  const perScheduleResumes = preparing.length ? Math.max(...preparing.map((s) => s.max_prepare)) : 0;
  const perScheduleSends = applying.length ? Math.max(...applying.map((s) => s.max_apply)) : 0;
  return [
    {
      step: "1. Find", question: "New jobs found on the job sources", last24h: i.last24h.found, waiting: undefined,
      limit: `No total limit. Postings up to ${i.discovery.max_age_days} days old; the same search is not repeated within ${n(i.discovery.min_rescan_hours, "hour")}.`,
      link: { label: "Settings, Find", href: "/settings#find" },
    },
    {
      step: "2. Score", question: "Each found job rated against your profile", last24h: i.last24h.scored, waiting: i.waiting.toScore,
      limit: "About 60 per pass, up to 8 passes per run. No daily limit of its own; the free AI models' daily allowance is the ceiling.",
      link: { label: "Models", href: "/models" },
    },
    {
      step: "3. Match", question: `Scored ${i.scoring.threshold} or more out of 100`, last24h: i.last24h.matched, waiting: undefined,
      limit: "No limit; the score decides.",
      link: { label: "Settings, Score and match", href: "/settings#score-match" },
    },
    {
      step: "4. Prepare", question: "Resume and cover letter written for a match", last24h: i.last24h.prepared, waiting: i.waiting.toPrepare,
      limit: `${preparing.length ? `A schedule writes up to ${n(perScheduleResumes, "resume")} per run. ` : "No schedule writes resumes. "}${i.autoPrepare.enabled && i.autoPrepare.per_run > 0 ? `Catch-up rounds write up to ${n(i.autoPrepare.per_run, "resume")} each, ${i.autoPrepare.concurrency} at a time, back to back until none is waiting.` : "Catch-up rounds are switched off."} No daily limit.`,
      link: { label: "Settings, Prepare", href: "/settings#prepare" },
    },
    {
      step: "5. Approve", question: "Prepared applications cleared to be sent", last24h: i.last24h.approved, waiting: i.waiting.toApprove,
      limit: `${approvalRule(i)}${applying.length ? ` Up to ${n(perScheduleSends, "approval")} per run. Same company: wait ${i.caps.company_cooldown_days} day${i.caps.company_cooldown_days === 1 ? "" : "s"}.` : ""}`,
      link: { label: "Settings, Approve and send", href: "/settings#approve-send" },
    },
    {
      step: "6. Send", question: "Approved applications actually submitted", last24h: i.last24h.sent, waiting: i.waiting.toSend,
      limit: `At most ${i.caps.daily_total} automatic submissions a day (${i.sentAutomaticallyToday} so far today). LinkedIn at most ${i.caps.daily_linkedin} a day and ${i.caps.weekly_linkedin} a week. ${i.caps.local_auto_enabled ? "The assistant on your computer presses Submit itself." : "The assistant on your computer waits for you to press Submit."}`,
      link: { label: "Settings, Approve and send", href: "/settings#approve-send" },
    },
  ];
}
