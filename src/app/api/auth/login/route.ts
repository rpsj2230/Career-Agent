import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authClient, isHttps } from "@/lib/auth-server";
import { getRole } from "@/lib/owner";
import { logActivity } from "@/lib/activity";

const Body = z.object({ email: z.email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  const supabase = authClient(await cookies(), isHttps(request));
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (error) {
    await logActivity({ kind: "auth.login_failed", level: "warn", message: `Failed sign-in for ${email}: wrong email or password`, detail: { email, ip, reason: "invalid credentials" } });
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }

  // Valid credentials are not enough: the account must be the owner, on ALLOWED_EMAILS, or given access in Team access.
  if (!(await getRole(email, true))) {
    await supabase.auth.signOut();
    await logActivity({ kind: "auth.login_failed", level: "warn", message: `Sign-in refused for ${email}: not the owner or an allowed email`, detail: { email, ip, reason: "not allowed" } });
    return NextResponse.json({ error: "This account is not allowed to use this app" }, { status: 403 });
  }
  await logActivity({ kind: "auth.login", message: `Signed in: ${email}`, detail: { email, ip } });
  return NextResponse.json({ ok: true });
}
