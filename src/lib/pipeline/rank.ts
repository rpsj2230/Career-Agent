/**
 * Order in which matches are prepared when there is not room for all of them. Fit comes first, but a newer posting gets a small
 * lead: early applicants are far more likely to be read, and an old posting is more likely to be filled or abandoned.
 */
export function freshnessBonus(postedAt: string | null | undefined, now = Date.now()): number {
  if (!postedAt) return 0;
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86_400_000;
  if (days <= 2) return 6;
  if (days <= 7) return 3;
  if (days <= 14) return 0;
  if (days <= 30) return -3;
  return -6;
}

export const rankScore = (score: number, postedAt: string | null | undefined, now = Date.now()) => score + freshnessBonus(postedAt, now);
