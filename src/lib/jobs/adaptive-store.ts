import "server-only";
import { db } from "@/lib/db";
import { suggestTitles } from "./adaptive";

/** Per country: titles that keep appearing in the jobs that matched you (last 60 days) but that you do not search for. */
export async function loadTitleSuggestions(configured: Record<string, string[]>): Promise<Record<string, { title: string; count: number }[]>> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const res = await db().from("jobs").select("title,country").in("status", ["queued", "prepared", "applied"]).gte("found_at", since).limit(3000);
  if (res.error) return {};
  const byCountry = new Map<string, string[]>();
  for (const r of res.data as { title: string; country: string | null }[]) {
    const c = (r.country ?? "").toLowerCase();
    if (c in configured) byCountry.set(c, [...(byCountry.get(c) ?? []), r.title]);
  }
  return Object.fromEntries([...byCountry].map(([c, titles]) => [c, suggestTitles(configured[c], titles)]).filter(([, s]) => (s as unknown[]).length > 0));
}
