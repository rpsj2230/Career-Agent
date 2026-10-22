import { plainField } from "./normalize";

/** Fields that earlier versions of the email reader saved with raw HTML or entities in them ("<td class=...", "Resaro &middot; Singapore"). */
export const looksGarbled = (s: string | null | undefined): boolean => !!s && /<[a-z/!]|&[a-z]{2,8};|&#\d+;|&#x[0-9a-f]+;/i.test(s);

export type JobText = { company: string; location: string | null };

/**
 * The company and place cleaned up, or null when nothing needs changing. A company written as "Resaro · Singapore (Hybrid)" (the email
 * put both in one line) is split into the company and the place; a place that was only HTML becomes empty (unknown).
 */
export function repairJobText(j: JobText): JobText | null {
  if (!looksGarbled(j.company) && !looksGarbled(j.location)) return null;
  let company = plainField(j.company);
  let location = plainField(j.location);
  const dot = company.match(/^(.+?)\s*[·•]\s*(.+)$/);
  if (dot) { company = dot[1].trim(); if (!location) location = dot[2].trim(); }
  return { company: company || "Unknown", location: location || null };
}

/**
 * Earlier versions read a portal's "your application was sent" receipt as a new job and kept its "Applied on October 19, 2026" line as the place.
 * That line says the job was already applied for; this returns the day (YYYY-MM-DD), or null for any other place.
 */
export function appliedOnDate(location: string | null | undefined): string | null {
  const m = (location ?? "").match(/^\s*applied (?:on )?(.{6,30})$/i);
  if (!m) return null;
  const t = Date.parse(`${m[1].trim()} 12:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
