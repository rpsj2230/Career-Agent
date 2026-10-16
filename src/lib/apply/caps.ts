import type { ApplyType } from "@/lib/jobs/normalize";
import type { Caps } from "@/lib/settings";

export type CapState = { automatedToday: number; linkedinAutomatedToday: number; linkedinAutomatedThisWeek: number };
export type ApplyDecision = { allowed: boolean; mode: "automated" | "assisted"; reason?: string };

/**
 * How may this application go out?
 * - Greenhouse/Lever: automated, within the daily total.
 * - LinkedIn: assisted unless automation is switched on; then automated within the daily/weekly caps,
 *   and assisted (never silently dropped) once a cap is reached.
 * - Login-gated portals and unknown sites: always assisted (you press the final submit).
 */
export function decideApply(type: ApplyType, caps: Caps, s: CapState): ApplyDecision {
  if (type === "greenhouse" || type === "lever") {
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
