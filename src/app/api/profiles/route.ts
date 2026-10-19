import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { createProfile, listProfiles, ProfileError, profilesReady } from "@/lib/profiles-store";

/** Profiles: super admin only (the access check in proxy.ts gives the other roles no route to here). */
export async function GET() {
  return NextResponse.json({ ready: await profilesReady(), profiles: await listProfiles() });
}

export async function POST(request: Request) {
  if (!(await profilesReady())) return NextResponse.json({ error: "Run the profiles migration first (System health shows the SQL)." }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; email?: unknown } | null;
  try {
    const p = await createProfile({ name: body?.name, email: body?.email });
    await logConfig(`Profile created: ${p.name}`, { profile: p.id, email: p.email });
    return NextResponse.json({ ok: true, profile: p });
  } catch (e) {
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
