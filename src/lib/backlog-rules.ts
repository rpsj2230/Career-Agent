/** When the hourly check should work through a backlog by itself (pure, so it is testable). */
export type DrainState = { at: string; noProgress: number } | null;

export function drainDecision(i: { unscored: number; unprepared: number; modelsUsable: boolean; autoPrepare: boolean; preparingSchedule: boolean; state: DrainState; now?: Date }): { drain: boolean; reason: string } {
  const now = i.now ?? new Date();
  if (!i.modelsUsable) return { drain: false, reason: "No AI model can be used right now, so the backlog waits." };
  const prepare = i.autoPrepare && i.preparingSchedule && i.unprepared > 0;
  if (i.unscored === 0 && !prepare) return { drain: false, reason: "Nothing is waiting." };
  // two rounds in a row that achieved nothing (for example every call failing): stop trying for a few hours instead of burning runner time
  if (i.state && i.state.noProgress >= 2 && now.getTime() - new Date(i.state.at).getTime() < 6 * 3_600_000) return { drain: false, reason: "The last backlog rounds made no progress; trying again later." };
  return { drain: true, reason: `${i.unscored} job(s) waiting to be scored${prepare ? ` and ${i.unprepared} match(es) waiting for a resume` : ""}.` };
}

/** Rough time to clear a backlog at what one hourly round does (about 60 scored and a handful prepared). */
export function hoursToClear(unscored: number, unprepared: number, perRunPrepare = 8): number {
  return Math.max(Math.ceil(unscored / 60), perRunPrepare > 0 ? Math.ceil(unprepared / perRunPrepare) : 0);
}
