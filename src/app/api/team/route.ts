import { NextResponse } from "next/server";
import { z } from "zod";
import { logConfig } from "@/lib/activity-helpers";
import { getOwnerEmail, getTeam, saveTeam } from "@/lib/owner";
import { parseAllowlist } from "@/lib/access";
import { listProfiles } from "@/lib/profiles-store";
import { TEAM_ROLES } from "@/lib/roles";

/** Team access: super admin only (the access check in proxy.ts gives the other roles no route to here). */
const Body = z.object({ email: z.email().max(200), role: z.enum(TEAM_ROLES), profiles: z.array(z.uuid()).max(20).optional() });
const MAX_MEMBERS = 25;

export async function GET() {
  return NextResponse.json({ members: await getTeam() });
}

export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address and choose an access level" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const admins = [await getOwnerEmail(true), ...parseAllowlist(process.env.ALLOWED_EMAILS)];
  if (admins.includes(email)) return NextResponse.json({ error: "That address is already a super admin" }, { status: 409 });
  const team = await getTeam();
  const rest = team.filter((m) => m.email !== email);
  if (rest.length >= MAX_MEMBERS) return NextResponse.json({ error: `At most ${MAX_MEMBERS} people can be added` }, { status: 400 });
  // the profiles this person may open: only ones that exist (none named = the main profile only, as before profiles existed)
  const known = new Set((await listProfiles()).map((p) => p.id));
  const profiles = (parsed.data.profiles ?? []).filter((id) => known.has(id));
  await saveTeam([...rest, { email, role: parsed.data.role, ...(profiles.length ? { profiles } : {}) }]);
  await logConfig(`Team access: ${email} set to ${parsed.data.role}${profiles.length ? ` for ${profiles.length} profile(s)` : ""}`, { email, role: parsed.data.role, profiles });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const team = await getTeam();
  if (!team.some((m) => m.email === email)) return NextResponse.json({ error: "Not on the list" }, { status: 404 });
  await saveTeam(team.filter((m) => m.email !== email));
  await logConfig(`Team access removed: ${email}`, { email });
  return NextResponse.json({ ok: true });
}
