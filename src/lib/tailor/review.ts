/**
 * A resume or cover letter the claim checker flagged ("needs review") is blocked from approval until a person has read it. Reviewing it keeps the list of flagged
 * claims on record and marks the document as checked by you, so the flag clears and the application can be approved without an override. Pure.
 */
export type Verification = { ok: boolean; issues?: { where: string; problem: string }[]; attempts?: number; reviewed?: { by: "you"; at: string; issues: number } } & Record<string, unknown>;

export const needsReview = (v: { ok?: boolean } | null | undefined): boolean => !!v && v.ok !== true;

/** The verification after you have read the flagged claims and accepted them. The issues stay on record. */
export function markReviewed(v: Verification, now = new Date()): Verification {
  return { ...v, ok: true, reviewed: { by: "you", at: now.toISOString(), issues: v.issues?.length ?? 0 } };
}
