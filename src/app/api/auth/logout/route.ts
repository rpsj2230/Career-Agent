import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient, isHttps } from "@/lib/auth-server";
import { logActivity } from "@/lib/activity";

export async function POST(request: Request) {
  await authClient(await cookies(), isHttps(request)).auth.signOut();
  await logActivity({ kind: "auth.logout", message: "Signed out" });
  return NextResponse.json({ ok: true });
}
