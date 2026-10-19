import { NextResponse } from "next/server";
import { PROFILE_COOKIE } from "@/lib/profile-access";
import { UUID } from "@/lib/profile-context";

/**
 * Remember which profile this browser is working on. Any signed-in role may call it; it only sets a cookie, and the access check
 * (proxy.ts) re-checks on every request that the person may open that profile, falling back to one they may.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !UUID.test(body.id)) return NextResponse.json({ error: "Not a profile id" }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PROFILE_COOKIE, body.id, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
