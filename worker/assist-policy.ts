/** When the apply assistant may press Submit by itself (hands-free mode). Pure rules, so they can be tested without a browser. */
export type AutoCaps = { daily_total: number; daily_linkedin: number; weekly_linkedin: number; linkedin_automation_enabled: boolean; local_auto_enabled?: boolean };
export type AutoState = { submittedToday: number; linkedinToday: number; linkedinThisWeek: number };
export type AutoDecision = { go: true } | { go: false; reason: string };

/**
 * - Off by default: you switch hands-free mode on in Settings.
 * - Never above the daily total, which counts everything submitted automatically from any machine.
 * - LinkedIn has its own opt-in and its own daily and weekly caps.
 */
export function autoDecision(portal: string | null | undefined, caps: AutoCaps, s: AutoState): AutoDecision {
  if (!caps.local_auto_enabled) return { go: false, reason: "Hands-free mode is switched off in Settings" };
  if (s.submittedToday >= caps.daily_total) return { go: false, reason: `Daily limit of ${caps.daily_total} automatic applications reached` };
  if (portal === "linkedin") {
    if (!caps.linkedin_automation_enabled) return { go: false, reason: "Automatic LinkedIn applying is switched off in Settings" };
    if (s.linkedinToday >= caps.daily_linkedin) return { go: false, reason: `LinkedIn daily limit (${caps.daily_linkedin}) reached` };
    if (s.linkedinThisWeek >= caps.weekly_linkedin) return { go: false, reason: `LinkedIn weekly limit (${caps.weekly_linkedin}) reached` };
  }
  return { go: true };
}

/** "9-21" = between 09:00 and 21:00 local time (21:00 itself is outside); "22-6" wraps past midnight; empty = always. */
export function withinHours(now: Date, spec: string | undefined): boolean {
  const m = spec?.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return true;
  const from = Number(m[1]), to = Number(m[2]), h = now.getHours();
  if (from === to) return true;
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** A pause that looks like a person between two automatic submissions: `min` to `max` seconds, never below `min`. */
export const humanPause = (min = 45, max = 120, rnd: () => number = Math.random) => Math.round((min + rnd() * (max - min)) * 1000);
