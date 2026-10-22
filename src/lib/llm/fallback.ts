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

/** What went wrong, in words: some providers fail with an empty message, so the error's name, status, cause and a bit of the reply are used too. */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e) || "unknown error";
  const x = e as Error & { statusCode?: number; status?: number; code?: string; cause?: unknown; responseBody?: string };
  const msg = (e.message ?? "").trim();
  if (msg) return msg;
  const cause = x.cause instanceof Error ? x.cause.message : typeof x.cause === "string" ? x.cause : "";
  const parts = [e.name !== "Error" ? e.name : "", x.statusCode ?? x.status ? `HTTP ${x.statusCode ?? x.status}` : "", x.code ?? "", cause, (x.responseBody ?? "").replace(/\s+/g, " ").slice(0, 120)].filter(Boolean);
  return parts.length ? parts.join(" ") : "the provider returned an error with no message (check the key and the model name on the Models page)";
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
export async function runWithFallback<T, M extends ModelRow = ModelRow>(
  task: Task,
  candidates: M[],
  call: (m: M, remainingMs?: number) => Promise<T>,
  onAttempt?: (m: M, ok: boolean, ms: number, error?: string) => Promise<void> | void,
  /** a point in time after which no further model is tried (a web request must answer before the host cuts it off) */
  deadline?: number,
): Promise<{ value: T; used: M }> {
  const attempts: { label: string; error: string }[] = [];
  for (const m of candidates) {
    if (deadline !== undefined && Date.now() > deadline - 3_000) { attempts.push({ label: m.label, error: "not tried: out of time for this request" }); break; }
    const t0 = Date.now();
    try {
      const value = await call(m, deadline === undefined ? undefined : Math.max(3_000, deadline - Date.now()));
      await onAttempt?.(m, true, Date.now() - t0);
      return { value, used: m };
    } catch (e) {
      const msg = describeError(e);
      attempts.push({ label: m.label, error: msg.slice(0, 300) });
      await onAttempt?.(m, false, Date.now() - t0, msg.slice(0, 500));
    }
  }
  throw new AllModelsFailed(task, attempts);
}

/** Local models are slow on a CPU runner, so they get far longer than a hosted API before being cut off. */
export const LOCAL_TIMEOUT_MS = 600_000;
export const timeoutFor = (m: Pick<ModelRow, "provider">): number | undefined => (m.provider === "ollama" ? LOCAL_TIMEOUT_MS : undefined);

/**
 * The last-resort local model. When `LOCAL_MODEL` is set (the GitHub workflow starts Ollama and sets it), the local row
 * is switched on, pointed at the runner's Ollama, given every task and moved to the very end of the chain, so it is
 * used only when every hosted model has failed or run out of quota. When it is not set (Vercel, your laptop without
 * Ollama) the local row is switched off so a dead localhost address is never attempted.
 */
/** The local model lives on the scheduled runner (it starts Ollama itself); the website cannot reach that address, so a test from the website is meaningless. */
export const isRunnerOnlyModel = (m: Pick<ModelRow, "provider" | "base_url">, env: Record<string, string | undefined>): boolean =>
  m.provider === "ollama" && !env.LOCAL_MODEL?.trim() && (!m.base_url || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(m.base_url));

export function withLocalFallback(rows: ModelRow[], env: Record<string, string | undefined>): ModelRow[] {
  const local = env.LOCAL_MODEL?.trim();
  return rows.map((m) => {
    if (m.provider !== "ollama") return m;
    if (!local) return { ...m, enabled: false };
    return { ...m, enabled: true, model: local, base_url: env.LOCAL_MODEL_URL?.trim() || "http://127.0.0.1:11434/v1", tasks: ["score", "tailor", "extract"], daily_cap: null, priority: 10_000 };
  });
}
