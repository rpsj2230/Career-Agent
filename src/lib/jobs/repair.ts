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
