import type { ApplyType } from "@/lib/jobs/normalize";
import type { Caps } from "@/lib/settings";
import { decideApply, type CapState } from "./caps";

export type AutoApplyInput = {
  /** schedule mode and whether it asks before submitting */
  mode: "scan" | "scan_prepare" | "scan_prepare_apply";
  requireApproval: boolean;
  /** both generated documents passed the anti-fabrication check */
  verified: boolean;
  applyType: ApplyType;
  /** the applicant-tracking system of the posting, when known (Ashby and Workable are applied for automatically too) */
  ats?: string | null;
  caps: Caps;
  capState: CapState;
  /** automated approvals already made by this run, and the run's limit */
  automatedThisRun: number;
  maxApply: number;
};
export type AutoDecision = { action: "approve" | "leave"; code: "scan_only" | "approval_required" | "unverified" | "run_limit" | "cap" | "ok"; reason: string };

/**
 * Should a schedule approve this prepared application by itself?
 * Never when the schedule asks first, never with unverified documents (a schedule cannot override that check),
 * never beyond the run's limit or the daily caps. Whatever it leaves stays visible as "Pending approval".
 * An approval can still end up as "Requires manual action" when the portal does not allow automation.
 */
export function decideAutoApply(i: AutoApplyInput): AutoDecision {
  if (i.mode !== "scan_prepare_apply") return { action: "leave", code: "scan_only", reason: "This schedule only prepares applications; they wait for your approval" };
  if (i.requireApproval) return { action: "leave", code: "approval_required", reason: "This schedule asks for your approval before submitting" };
  if (!i.verified) return { action: "leave", code: "unverified", reason: "The documents contain claims that are not in your profile; review them before approving" };
  const d = decideApply(i.applyType, i.caps, i.capState, i.ats);
  if (!d.allowed) return { action: "leave", code: "cap", reason: d.reason ?? "Daily limit reached" };
  if (d.mode === "automated" && i.automatedThisRun >= i.maxApply) return { action: "leave", code: "run_limit", reason: `This schedule's limit of ${i.maxApply} automatic submissions per run was reached` };
  return { action: "approve", code: "ok", reason: d.mode === "automated" ? "Approved for automatic submission" : (d.reason ?? "Approved; this portal needs you to press the final submit") };
}
