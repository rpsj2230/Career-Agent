import { NextResponse } from "next/server";
import { discover } from "@/lib/jobs/sources";
import { ingestJobs } from "@/lib/jobs/ingest";
import { getSetting } from "@/lib/settings";
import { getProfile } from "@/lib/profile/store";

export const maxDuration = 60;

/** Authorised by proxy.ts (CRON_SECRET bearer token, which Vercel Cron and GitHub Actions can send). */
export async function GET() {
  const settings = await getSetting("discovery");
  const profile = await getProfile();
  // Profile preferences take effect when the settings page has not overridden them.
  const effective = {
    ...settings,
    countries: settings.countries.length ? settings.countries : profile.preferences.countries,
    roles: settings.roles.length ? settings.roles : profile.preferences.roles,
  };
  if (effective.roles.length === 0) {
    return NextResponse.json({ error: "No target roles set. Add roles in Settings or your profile preferences." }, { status: 422 });
  }
  const results = await discover(effective);
  const all = results.flatMap((r) => r.jobs);
  const ingest = await ingestJobs(all, effective.max_age_days);
  return NextResponse.json({
    fetched: all.length,
    ...ingest,
    sourceErrors: results.filter((r) => r.error).map((r) => ({ source: r.source, error: r.error })),
  });
}
