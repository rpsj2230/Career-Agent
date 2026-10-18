import "server-only";
import { getSetting } from "@/lib/settings";

/** The master pause: while on, nothing runs by itself (searching, scoring, preparing, automatic approving and applying). Buttons you press still work. */
export async function automationPaused(): Promise<boolean> {
  try { return (await getSetting("automation_pause")).paused === true; } catch { return false; }
}
