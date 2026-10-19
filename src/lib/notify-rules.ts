/** Who hears about what, kept free of I/O so it can be tested. */

/** The addresses a notification goes to: the person running the app, the profile's own address, and any extra address, once each. */
export function recipients(admin: string | null | undefined, profileEmail: string | null | undefined, extra: (string | null | undefined)[] = []): string[] {
  const seen = new Set<string>();
  for (const a of [admin, profileEmail, ...extra]) {
    const e = a?.trim().toLowerCase();
    if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) seen.add(e);
  }
  return [...seen];
}

/** "[Priya] text" once there is more than one profile, so a message is never confused with another person's; unchanged for a single profile. */
export function labelled(text: string, profileName: string | null | undefined, profileCount: number): string {
  return profileName && profileCount > 1 ? `[${profileName}] ${text}` : text;
}

/** An email subject from the notification: the explicit subject, else the first line, never empty, never over 120 characters. */
export function subjectFor(text: string, subject: string | undefined, profileName: string | null | undefined, profileCount: number): string {
  const base = (subject ?? text.split("\n").find((l) => l.trim()) ?? "Career Agent").replace(/\s+/g, " ").trim();
  return labelled(base || "Career Agent", profileName, profileCount).slice(0, 120);
}
