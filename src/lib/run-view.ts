/**
 * How one run is shown: the same six steps everywhere (Find, Score, Match, Prepare, Approve, Send), each with one number,
 * built only from what the run recorded. Pure, so every rule is tested; src/lib/run-queries.ts reads the facts.
 */
export type Stats = Record<string, number>;

export type RunCounts = {
  found: number; scored: number; matched: number; prepared: number; approved: number;
  /** prepared applications this run left for you (a limit, the same-company wait, an unverified claim) */
  left: number;
  /** things that went wrong: searches, scoring, preparing or approvals */
  problems: number;
};

const n = (s: Stats, k: string) => Number(s[k] ?? 0) || 0;

export function runCounts(stats: Stats | null | undefined): RunCounts {
  const s = stats ?? {};
  const left = Object.entries(s).filter(([k]) => k.startsWith("left_")).reduce((a, [, v]) => a + (Number(v) || 0), 0);
  return {
    found: n(s, "inserted"), scored: n(s, "scored"), matched: n(s, "matched"), prepared: n(s, "prepared"),
    approved: n(s, "auto_approved") + n(s, "manual_required"), left,
    problems: n(s, "scan_errors") + n(s, "failed") + n(s, "prepare_failed") + n(s, "approval_blocked"),
  };
}

/** Plain words for why a prepared application was left for you instead of being approved. */
export const LEFT_REASONS: Record<string, string> = {
  left_cooldown: "applied to the same company recently",
  left_cap: "the daily limit was reached",
  left_run_limit: "this schedule's per-run limit was reached",
  left_unverified: "the resume has a claim that could not be verified",
  left_approval_required: "the schedule asks you to approve first",
  left_scan_only: "the schedule only prepares applications",
};

export function leftReasons(stats: Stats | null | undefined): { code: string; count: number; text: string }[] {
  return Object.entries(stats ?? {}).filter(([k, v]) => k.startsWith("left_") && Number(v) > 0)
    .map(([code, v]) => ({ code, count: Number(v), text: LEFT_REASONS[code] ?? code.replace(/^left_/, "").replace(/_/g, " ") }))
    .sort((a, b) => b.count - a.count);
}

export type StepRow = { step: string; result: string; detail: string; tone: "ok" | "warn" | "none" };
export type SourceSummary = { source: string; scans: number; failed: number; fetched: number; inserted: number };

const plural = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** The six steps of a run as table rows: what happened in each, in one sentence. */
export function stepRows(stats: Stats | null | undefined, sources: SourceSummary[], o: { threshold: number; mode?: string | null }): StepRow[] {
  const s = stats ?? {};
  const c = runCounts(s);
  const searches = sources.reduce((a, x) => a + x.scans, 0);
  const failedSearches = sources.reduce((a, x) => a + x.failed, 0);
  const fetched = sources.reduce((a, x) => a + x.fetched, 0) || n(s, "fetched");
  const scanOnly = o.mode === "scan";
  const rows: StepRow[] = [];

  rows.push({
    step: "1. Find", tone: failedSearches ? "warn" : searches || fetched ? "ok" : "none",
    result: `${c.found} new`,
    detail: searches || fetched
      ? `${plural(searches, "search", "searches")} on ${plural(sources.length, "source")}, ${fetched} postings returned, ${n(s, "duplicates")} already known${n(s, "stale") ? `, ${n(s, "stale")} too old` : ""}${failedSearches ? `, ${failedSearches} search${failedSearches === 1 ? "" : "es"} failed` : ""}.`
      : "No search was run in this round (it only worked through the backlog).",
  });
  rows.push({
    step: "2. Score", tone: n(s, "failed") ? "warn" : c.scored ? "ok" : "none",
    result: `${c.scored} scored`,
    detail: c.scored || n(s, "rejected_by_rules")
      ? `${n(s, "rejected_by_rules")} dropped by your rules without an AI model, ${n(s, "model_calls")} AI call${n(s, "model_calls") === 1 ? "" : "s"}${n(s, "escalated") ? `, ${n(s, "escalated")} re-judged by the stronger model` : ""}${n(s, "failed") ? `, ${n(s, "failed")} could not be scored (retried next run)` : ""}.`
      : "Nothing was waiting to be scored.",
  });
  rows.push({
    step: "3. Match", tone: c.matched ? "ok" : "none",
    result: `${c.matched} matched`,
    detail: `A fit score of ${o.threshold} or more matches; ${n(s, "rejected")} scored below it.`,
  });
  rows.push(scanOnly
    ? { step: "4. Prepare", tone: "none", result: "-", detail: "This schedule only searches and scores; it does not write resumes." }
    : {
      step: "4. Prepare", tone: n(s, "prepare_failed") ? "warn" : c.prepared ? "ok" : "none",
      result: `${c.prepared} prepared`,
      detail: `Resume and cover letter written for each${n(s, "prepare_failed") ? `; ${n(s, "prepare_failed")} failed (retried next run)` : ""}${n(s, "closed_before_applying") ? `; ${n(s, "closed_before_applying")} closed before applying (role gone or already applied)` : ""}.`,
    });
  const why = leftReasons(s);
  rows.push(scanOnly || o.mode === "scan_prepare"
    ? { step: "5. Approve", tone: "none", result: "-", detail: o.mode === "scan_prepare" ? "This schedule prepares applications and waits for you to approve them." : "Not part of this schedule." }
    : {
      step: "5. Approve", tone: n(s, "approval_blocked") ? "warn" : c.approved ? "ok" : "none",
      result: `${c.approved} approved`,
      detail: `${n(s, "auto_approved")} sent for automatic applying, ${n(s, "manual_required")} for the assistant to open${c.left ? `; ${c.left} left for you (${why.map((w) => `${w.count} ${w.text}`).join(", ")})` : ""}${n(s, "approval_blocked") ? `; ${n(s, "approval_blocked")} refused` : ""}.`,
    });
  return rows;
}

export type UsageRow = { model_label: string; task: string; ok: boolean; error: string | null; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null };
export type ModelLine = { model: string; task: string; calls: number; ok: number; failed: number; inputTokens: number; outputTokens: number; avgMs: number | null; lastError: string | null };

const TASK_LABELS: Record<string, string> = { score: "Scoring jobs", tailor: "Writing resume and cover letter", prepare: "Preparing an application", prepare_many: "Preparing applications", regenerate: "Rewriting a resume", extract: "Reading a profile or job", test: "Model test", localtest: "Local model test" };
export const taskLabel = (t: string) => TASK_LABELS[t] ?? t;

/** Which AI model did what during a run: calls, successes, failures, tokens and average speed, one line per model and task. */
export function modelLines(rows: UsageRow[]): ModelLine[] {
  const m = new Map<string, ModelLine & { ms: number; msCount: number }>();
  for (const r of rows) {
    const key = `${r.model_label}\u0000${r.task}`;
    const l = m.get(key) ?? { model: r.model_label, task: r.task, calls: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, avgMs: null, lastError: null, ms: 0, msCount: 0 };
    l.calls++; if (r.ok) l.ok++; else { l.failed++; l.lastError ??= r.error; }
    l.inputTokens += r.input_tokens ?? 0; l.outputTokens += r.output_tokens ?? 0;
    if (r.latency_ms != null) { l.ms += r.latency_ms; l.msCount++; }
    m.set(key, l);
  }
  return [...m.values()].map(({ ms, msCount, ...l }) => ({ ...l, avgMs: msCount ? Math.round(ms / msCount) : null })).sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}

export const duration = (ms: number | null): string => (ms == null ? "-" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export type Problem = { id: number; at: string; level: string; message: string; company: string | null };
export type ProblemGroup = { key: string; level: string; count: number; first: string; last: string; example: string };

/** The same problem repeated for every search (a source that is down fails each of its searches) shown once, with how many times and an example. */
export function groupProblems(rows: Problem[]): ProblemGroup[] {
  const m = new Map<string, ProblemGroup>();
  for (const r of rows) {
    const key = `${r.level}|${r.message.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "#")}`;
    const g = m.get(key);
    if (!g) { m.set(key, { key, level: r.level, count: 1, first: r.at, last: r.at, example: r.message }); continue; }
    g.count++;
    if (r.at < g.first) g.first = r.at;
    if (r.at > g.last) g.last = r.at;
  }
  return [...m.values()].sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === "error" ? -1 : 1));
}
