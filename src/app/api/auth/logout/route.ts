import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authClient, isHttps } from "@/lib/auth-server";

export async function POST(request: Request) {
  await authClient(await cookies(), isHttps(request)).auth.signOut();
  return NextResponse.json({ ok: true });
}
