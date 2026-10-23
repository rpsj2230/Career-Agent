import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { hashSecret, LEGACY_PROFILE, LINK_SETTING, makeToken, parseToken } from "@/lib/extension/link";
import { makeLinkCode } from "@/lib/extension/link-code";
import { currentProfileId } from "@/lib/profile-context";
import { rawClient } from "@/lib/raw-client";
import { profilesEnabled } from "@/lib/scope";
import { getSetting, putSetting } from "@/lib/settings";

/** Whether the extension is linked, and make (or replace) its link code. The code is shown once; only a hash of it is kept. */
export async function GET() {
  const rec = await getSetting(LINK_SETTING);
  return NextResponse.json({ linked: !!rec.hash, created_at: rec.created_at || null });
}

export async function POST(request: Request) {
  const profileId = (await profilesEnabled(rawClient())) ? await currentProfileId() : LEGACY_PROFILE;
  const token = makeToken(profileId);
  await putSetting(LINK_SETTING, { hash: hashSecret(parseToken(token)!.secret), created_at: new Date().toISOString() });
  await logConfig("Browser extension link code created", {});
  return NextResponse.json({ ok: true, code: makeLinkCode(new URL(request.url).origin, token) });
}

export async function DELETE() {
  await putSetting(LINK_SETTING, { hash: "", created_at: "" });
  await logConfig("Browser extension unlinked", {});
  return NextResponse.json({ ok: true });
}
