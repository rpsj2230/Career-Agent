/** What the assistant is doing right now and what it did lately: reported with its heartbeat so the app can show it. Pure, so it is testable. */
export type Recent = { at: string; title: string; company: string; portal: string; outcome: "submitted" | "handed_back" | "left"; note?: string };
export type Live = { id: string; title: string; company: string; portal: string; step: string; since: string; /** when the picture of what the assistant sees was last updated */ shotAt?: string };

/** Newest first, at most `cap`, notes kept short (they are reasons, never answers or personal data). */
export function pushRecent(list: Recent[], item: Recent, cap = 12): Recent[] {
  return [{ ...item, note: item.note?.replace(/\s+/g, " ").slice(0, 220) }, ...list].slice(0, cap);
}

/** The "No application form was found" hand-backs that LinkedIn gave while the assistant's browser was signed out are worth one more try once it is signed in. */
export const NO_FORM = "No application form was found";
export function staleLinkedinNoForm(apps: { id: string; job_id: string; error: string | null }[], portals: Map<string, string | null>, alreadyRetried: Set<string>): string[] {
  return apps.filter((a) => (a.error ?? "").startsWith(NO_FORM) && (portals.get(a.job_id) ?? "").toLowerCase() === "linkedin" && !alreadyRetried.has(a.id)).map((a) => a.id);
}

/**
 * Hand-backs written by an older assistant that could not say what was wrong: a lone "Yes" or "No" box, a password it should never have offered as a question,
 * or "Could not reach the final step" with no detail. The assistant is better at all three now, so each gets one more try.
 */
export const OLD_READING = /a required box that is not a plain agreement|^Needs you:[\s\S]*\b(confirm )?password\b|^Could not reach the final step of the form\s*$/i;
export function staleOldReading(apps: { id: string; error: string | null }[], alreadyRetried: Set<string>): string[] {
  return apps.filter((a) => OLD_READING.test(a.error ?? "") && !alreadyRetried.has(a.id)).map((a) => a.id);
}

/** The application the assistant is working on, only while the assistant is reporting in and the step is recent (a crashed worker leaves an old one behind). */
export function liveNow(hb: { at: string; live?: Live | null } | null | undefined, now = new Date(), staleMs = 3 * 60_000): Live | null {
  if (!hb?.live || !hb.at) return null;
  if (now.getTime() - new Date(hb.at).getTime() > staleMs) return null;
  if (now.getTime() - new Date(hb.live.since).getTime() > 20 * 60_000) return null;
  return hb.live;
}
