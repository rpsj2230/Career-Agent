import type { ApplyType } from "@/lib/jobs/normalize";
import type { Caps } from "@/lib/settings";

import { AUTO_APPLY_ATS } from "@/lib/jobs/ats";

export type CapState = { automatedToday: number; linkedinAutomatedToday: number; linkedinAutomatedThisWeek: number; /** ATS whose automatic applying is paused because it keeps failing */ brokenAts?: string[] };

/** One automatic attempt: it worked, it failed for a technical reason, or it only needed one of your answers (which says nothing about the form). */
export type Attempt = { ats: string; outcome: "ok" | "bad" | "neutral"; at: string };

/**
 * Automatic applying on an ATS pauses (its applications are prepared for you instead) after its last five meaningful attempts all
 * failed technically, for example because the form changed. It tries once a day to see if it recovered. A question the agent
 * simply had no answer for does not count against it.
 */
export function brokenAts(attempts: Attempt[], now = Date.now(), need = 5): string[] {
  const byAts = new Map<string, Attempt[]>();
  for (const a of attempts.filter((x) => x.outcome !== "neutral")) byAts.set(a.ats, [...(byAts.get(a.ats) ?? []), a]);
  const out: string[] = [];
  for (const [ats, list] of byAts) {
    const recent = [...list].sort((x, y) => y.at.localeCompare(x.at)).slice(0, need);
    if (recent.length < need || recent.some((a) => a.outcome === "ok")) continue;
    if (now - new Date(recent[0].at).getTime() < 24 * 3_600_000) out.push(ats); // a day after the last failure it may try again
  }
  return out;
}
export type ApplyDecision = { allowed: boolean; mode: "automated" | "assisted"; reason?: string };

/**
 * How may this application go out?
 * - Greenhouse/Lever: automated, within the daily total.
 * - LinkedIn: assisted unless automation is switched on; then automated within the daily/weekly caps,
 *   and assisted (never silently dropped) once a cap is reached.
 * - Login-gated portals and unknown sites: always assisted (you press the final submit).
 */
export function decideApply(type: ApplyType, caps: Caps, s: CapState, ats?: string | null): ApplyDecision {
  const site = ats ?? (type === "greenhouse" || type === "lever" ? type : null);
  if (site && (AUTO_APPLY_ATS as string[]).includes(site) && s.brokenAts?.includes(site)) {
    return { allowed: true, mode: "assisted", reason: `Automatic applying on ${site} is paused: its last attempts failed technically, so the form may have changed. Prepared for you to submit.` };
  }
  if (site && (AUTO_APPLY_ATS as string[]).includes(site)) {
    return s.automatedToday >= caps.daily_total
      ? { allowed: false, mode: "assisted", reason: `Daily limit of ${caps.daily_total} automated applications reached` }
      : { allowed: true, mode: "automated" };
  }
  if (type === "linkedin" && caps.linkedin_automation_enabled) {
    if (s.automatedToday >= caps.daily_total) return { allowed: false, mode: "assisted", reason: `Daily limit of ${caps.daily_total} automated applications reached` };
    if (s.linkedinAutomatedToday >= caps.daily_linkedin) return { allowed: true, mode: "assisted", reason: `LinkedIn daily cap (${caps.daily_linkedin}) reached; prepared for manual submit` };
    if (s.linkedinAutomatedThisWeek >= caps.weekly_linkedin) return { allowed: true, mode: "assisted", reason: `LinkedIn weekly cap (${caps.weekly_linkedin}) reached; prepared for manual submit` };
    return { allowed: true, mode: "automated" };
  }
  return { allowed: true, mode: "assisted" };
}
