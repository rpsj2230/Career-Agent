import "server-only";
import { loadCapState } from "@/lib/apply/state";
import { readPipelineCounts } from "@/lib/pipeline-counts";
import { pipelineTable, type TableInput } from "@/lib/pipeline-table";
import { describeSchedule } from "@/lib/schedule";
import { listSchedules } from "@/lib/schedule-store";
import { getSetting } from "@/lib/settings";

/** Reads the numbers behind the pipeline table. Each one stands alone, so one failing read never hides the others. */
export async function loadPipelineTable(now: Date = new Date()) {
  const [{ rows: schedules }, autoPrepare, caps, autoapply, scoring, discovery] = await Promise.all([
    listSchedules().catch(() => ({ rows: [], missing: false })), getSetting("auto_prepare"), getSetting("caps"), getSetting("autoapply"), getSetting("scoring"), getSetting("discovery"),
  ]);
  const threshold = scoring.threshold ?? 65;
  const [counts, state] = await Promise.all([readPipelineCounts(now, threshold), loadCapState().catch(() => ({ automatedToday: 0 }))]);
  const input: TableInput = {
    last24h: counts.last24h, waiting: counts.waiting,
    autoPrepare: { enabled: !!autoPrepare.enabled, per_run: autoPrepare.per_run ?? 0, concurrency: autoPrepare.concurrency ?? 3 },
    schedules: schedules.map((s) => ({ name: s.name, mode: s.mode, max_prepare: s.max_prepare, max_apply: s.max_apply, require_approval: s.require_approval, enabled: s.enabled, paused: s.paused })),
    caps: { daily_total: caps.daily_total ?? 15, daily_linkedin: caps.daily_linkedin ?? 10, weekly_linkedin: caps.weekly_linkedin ?? 40, local_auto_enabled: !!caps.local_auto_enabled, company_cooldown_days: caps.company_cooldown_days ?? 14 },
    autoApplyOn: !!autoapply.enabled, sentAutomaticallyToday: state.automatedToday,
    discovery: { max_age_days: discovery.max_age_days ?? 30, min_rescan_hours: discovery.min_rescan_hours ?? 6 }, scoring: { threshold },
  };
  return { rows: pipelineTable(input), input, schedulesText: schedules.filter((s) => s.enabled && !s.paused).map((s) => `${s.name}: ${describeSchedule(s)}`) };
}
