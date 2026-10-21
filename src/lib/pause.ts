import "server-only";
import { getSetting } from "@/lib/settings";
import { pauseActive } from "@/lib/pause-rules";

/** The master pause: while on, nothing runs by itself (searching, scoring, preparing, automatic approving and applying). Buttons you press still work. */
export async function automationPaused(): Promise<boolean> {
  try { return pauseActive(await getSetting("automation_pause")); } catch { return false; }
}
