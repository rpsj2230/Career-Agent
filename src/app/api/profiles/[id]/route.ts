import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { UUID } from "@/lib/profile-context";
import { deleteProfile, ProfileError, updateProfile } from "@/lib/profiles-store";

const bad = (e: unknown) => {
  if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: 400 });
  throw e;
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not a profile id" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; email?: unknown; enabled?: unknown } | null;
  try {
    const p = await updateProfile(id, { name: body?.name, email: body?.email, enabled: body?.enabled });
    await logConfig(`Profile updated: ${p.name}${p.enabled ? "" : " (automation switched off)"}`, { profile: p.id, email: p.email, enabled: p.enabled });
    return NextResponse.json({ ok: true, profile: p });
  } catch (e) { return bad(e); }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not a profile id" }, { status: 400 });
  try {
    await deleteProfile(id);
    await logConfig("A profile and all of its data were deleted", { profile: id });
    return NextResponse.json({ ok: true });
  } catch (e) { return bad(e); }
}
