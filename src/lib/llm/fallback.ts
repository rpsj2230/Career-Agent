import type { Task } from "@/lib/types";

export type ModelRow = {
  id: string;
  label: string;
  provider: string;
  base_url: string;
  model: string;
  api_key_env: string | null;
  tasks: string[];
  priority: number;
  daily_cap: number | null;
  enabled: boolean;
};

/**
 * Pick the models that may serve `task`, best first. A model is skipped when it is disabled,
 * does not serve the task, has no usable API key (see `hasKey`), or has used up its daily cap.
 */
export function selectCandidates(
  rows: ModelRow[],
  task: Task,
  hasKey: (m: ModelRow) => boolean,
  usedToday: Record<string, number>,
): ModelRow[] {
  return rows
    .filter((m) => m.enabled && m.tasks.includes(task))
    .filter((m) => hasKey(m))
    .filter((m) => m.daily_cap === null || (usedToday[m.label] ?? 0) < m.daily_cap)
    .sort((a, b) => a.priority - b.priority);
}

export class AllModelsFailed extends Error {
  constructor(public task: Task, public attempts: { label: string; error: string }[]) {
    super(
      attempts.length === 0
        ? `No model available for task "${task}": add an API key or enable a model on the Models page`
        : `All models failed for task "${task}": ${attempts.map((a) => `${a.label}: ${a.error}`).join(" | ")}`,
    );
  }
}

/** Try candidates in order until one succeeds. `onAttempt` lets the caller log usage. */
export async function runWithFallback<T>(
  task: Task,
  candidates: ModelRow[],
  call: (m: ModelRow) => Promise<T>,
  onAttempt?: (m: ModelRow, ok: boolean, ms: number, error?: string) => Promise<void> | void,
): Promise<{ value: T; used: ModelRow }> {
  const attempts: { label: string; error: string }[] = [];
  for (const m of candidates) {
    const t0 = Date.now();
    try {
      const value = await call(m);
      await onAttempt?.(m, true, Date.now() - t0);
      return { value, used: m };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ label: m.label, error: msg.slice(0, 300) });
      await onAttempt?.(m, false, Date.now() - t0, msg.slice(0, 500));
    }
  }
  throw new AllModelsFailed(task, attempts);
}
