import { ATS_LABEL, parseAtsUrl } from "@/lib/jobs/ats";
import { portalLabel } from "@/lib/jobs/portal";

/** How applications are going, by where they were sent: what worked, what needed you, and why things stopped. Pure. */
export type AttemptRow = { status: string; method: string | null; error: string | null; portal: string | null; url: string | null; apply_type: string | null };
export type ChannelStats = { channel: string; label: string; attempts: number; submitted: number; needsYou: number; failed: number; rate: number; automated: number; topReasons: { reason: string; count: number }[] };

export function channelOf(r: Pick<AttemptRow, "portal" | "url" | "apply_type">): { channel: string; label: string } {
  const ats = r.url ? parseAtsUrl(r.url)?.ats : r.apply_type === "greenhouse" || r.apply_type === "lever" ? r.apply_type : undefined;
  if (ats) return { channel: ats, label: ATS_LABEL[ats] };
  const portal = r.portal ?? (r.apply_type && r.apply_type !== "unknown" ? r.apply_type : "other");
  return { channel: portal, label: portalLabel(portal) };
}

/** The error as a short, comparable reason (numbers, ids and quoted text removed). */
export function reasonsOf(error: string | null, status: string): string[] {
  const e = (error ?? "").trim();
  if (!e) return [status === "failed" ? "Failed without a message" : "Stopped"];
  const needs = e.match(/^Needs you:\s*(.*)$/i);
  if (needs) return needs[1].split(/;\s*/).filter(Boolean).map((q) => `Needs an answer: ${q.replace(/\s*\(.*$/, "").slice(0, 70)}`);
  return [e.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "").replace(/["'“”][^"'“”]*["'“”]/g, "").replace(/\d+/g, "N").replace(/\s+/g, " ").trim().slice(0, 100)];
}

export function summariseApply(rows: AttemptRow[]): ChannelStats[] {
  const by = new Map<string, ChannelStats & { reasons: Map<string, number> }>();
  for (const r of rows) {
    if (!["submitted", "needs_input", "failed"].includes(r.status)) continue;
    const { channel, label } = channelOf(r);
    const c = by.get(channel) ?? { channel, label, attempts: 0, submitted: 0, needsYou: 0, failed: 0, rate: 0, automated: 0, topReasons: [], reasons: new Map() };
    c.attempts++;
    if (r.method === "automated") c.automated++;
    if (r.status === "submitted") c.submitted++;
    else {
      if (r.status === "needs_input") c.needsYou++; else c.failed++;
      for (const reason of reasonsOf(r.error, r.status)) c.reasons.set(reason, (c.reasons.get(reason) ?? 0) + 1);
    }
    by.set(channel, c);
  }
  return [...by.values()].map(({ reasons, ...c }) => ({ ...c, rate: c.attempts ? Math.round((100 * c.submitted) / c.attempts) : 0, topReasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })) }))
    .sort((a, b) => b.attempts - a.attempts);
}
