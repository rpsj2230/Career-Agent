/**
 * Filter Auto Apply: the extension works through jobs the owner filtered on LinkedIn or Naukri, jobs that are not (yet) in Career Agent. These rules decide, before each
 * one, whether it may be sent. Pure: the route loads the numbers.
 */
export type ExternalPortal = "linkedin" | "naukri";

export type ExternalLimits = {
  /** the Auto-Apply master switch, pause and daily total, already decided (see decideAuto) */
  auto: { allowed: boolean; remainingToday: number; why: string | null };
  /** Settings: "Allow automated LinkedIn Easy Apply", and the LinkedIn daily and weekly limits */
  linkedinEnabled: boolean;
  dailyLinkedin: number;
  weeklyLinkedin: number;
  linkedinToday: number;
  linkedinWeek: number;
};

export type ExternalVerdict = { ok: true } | { ok: false; why: string; /** true when no other job may be sent either (switch off, a limit used up) */ global: boolean };

export function externalAllowed(portal: ExternalPortal, l: ExternalLimits): ExternalVerdict {
  if (!l.auto.allowed) return { ok: false, why: l.auto.why ?? "Automatic applying is not allowed right now.", global: true };
  if (portal === "linkedin") {
    if (!l.linkedinEnabled) return { ok: false, why: "\"Allow automated LinkedIn Easy Apply\" is switched off in Career Agent (Settings), so the extension will not send LinkedIn applications.", global: true };
    if (l.linkedinToday >= l.dailyLinkedin) return { ok: false, why: `Today's LinkedIn limit of ${l.dailyLinkedin} applications is used up.`, global: true };
    if (l.linkedinWeek >= l.weeklyLinkedin) return { ok: false, why: `This week's LinkedIn limit of ${l.weeklyLinkedin} applications is used up.`, global: true };
  }
  return { ok: true };
}

/** How many applications may still go out in this run, per what Career Agent allows (the extension also stops at its own per-run maximum). */
export function remainingFor(portal: ExternalPortal, l: ExternalLimits): number {
  if (!l.auto.allowed) return 0;
  if (portal !== "linkedin") return l.auto.remainingToday;
  if (!l.linkedinEnabled) return 0;
  return Math.max(0, Math.min(l.auto.remainingToday, l.dailyLinkedin - l.linkedinToday, l.weeklyLinkedin - l.linkedinWeek));
}

/** What an existing application for the same job means for sending it again. */
export function duplicateVerdict(existing: { status: string } | null): { ok: true } | { ok: false; why: string } {
  if (!existing) return { ok: true };
  if (existing.status === "submitted") return { ok: false, why: "Career Agent already has this job as sent" };
  if (existing.status === "approved" || existing.status === "submitting") return { ok: false, why: "another worker is already sending this job" };
  return { ok: true }; // prepared, waiting for the assistant, needs an answer, failed: sending it here settles that application
}

/** The number in a LinkedIn job link, or null. */
export const linkedinJobId = (u: string | null | undefined): string | null => (u ?? "").match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ?? (u ?? "").match(/currentJobId=(\d{6,})/)?.[1] ?? null;
