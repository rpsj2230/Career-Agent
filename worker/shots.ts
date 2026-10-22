import type { SupabaseClient } from "@supabase/supabase-js";
import { shotPaths } from "../src/lib/apply/screenshot-policy";

/** Delete pictures of an application from storage at once (the live view once it is over, the working pictures once it is sent). Never throws: a picture is only a courtesy. */
export async function dropShots(sb: SupabaseClient, appId: string, which: ("live" | "last" | "proof")[]): Promise<void> {
  try {
    const p = shotPaths(appId);
    await sb.storage.from("documents").remove(which.map((w) => p[w]));
  } catch { /* nothing to clean up, or storage is unreachable: the sweep tries again */ }
}
