import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient, isHttps } from "@/lib/auth-server";
import { logActivity } from "@/lib/activity";
import { PROFILE_COOKIE } from "@/lib/profile-access";

export async function POST(request: Request) {
  await authClient(await cookies(), isHttps(request)).auth.signOut();
  await logActivity({ kind: "auth.logout", message: "Signed out" });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(PROFILE_COOKIE); // the next person on this browser starts on their own profile
  return res;
}
