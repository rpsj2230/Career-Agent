import type { Check } from "./automation-checks";

export type Delivery = { enabled: boolean; hour: number; telegram: boolean; email: boolean; to: string };

/** Whether the daily message is due: switched on, past your chosen hour, and not already sent today. */
export function evaluateDelivery(i: { enabled: boolean; hour: number; localHour: number; today: string; lastDate: string | null }): "send" | "off" | "too early" | "already sent today" {
  if (!i.enabled) return "off";
  if (i.lastDate === i.today) return "already sent today";
  if (i.localHour < i.hour) return "too early";
  return "send";
}

/** Plain-language health section: what is healthy, and for each thing that is not, what is wrong and how to fix it. */
export function healthText(checks: Check[]): string {
  const bad = checks.filter((c) => c.status !== "ok");
  const ok = checks.filter((c) => c.status === "ok");
  const lines = ["HEALTH CHECK", bad.length === 0 ? "Everything is healthy." : `${bad.length} thing(s) need attention:`];
  for (const c of bad) lines.push(`- ${c.status === "fail" ? "PROBLEM" : "CHECK"}: ${c.label}: ${c.detail}${c.fix ? `\n    How to fix: ${c.fix}` : ""}`);
  if (ok.length) lines.push(`Healthy: ${ok.map((c) => c.label).join(", ")}.`);
  return lines.join("\n");
}

type Run = { kind: string; status: string; started_at: string; finished_at: string | null; stats: Record<string, number>; error: string | null; trigger: string };

/** What each automatic run did on the day, one line each, so the history is in the message itself. */
export function runsText(runs: Run[], tz?: string): string {
  if (runs.length === 0) return "RUNS\nNo automatic run happened that day.";
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const word: Record<string, string> = { pipeline: "Scheduled run", scan: "Search", score: "Scoring", prepare: "Preparing" };
  return ["RUNS", ...runs.map((r) => {
    const s = r.stats ?? {};
    const parts = [s.inserted != null && `${s.inserted} found`, s.scored != null && `${s.scored} scored`, s.matched != null && `${s.matched} matched`, s.prepared != null && `${s.prepared} prepared`].filter(Boolean);
    return `- ${t(r.started_at)} ${word[r.kind] ?? r.kind} (${r.trigger}): ${r.status}${parts.length ? ` — ${parts.join(", ")}` : ""}${r.error ? ` — ${r.error.slice(0, 160)}` : ""}`;
  })].join("\n");
}
