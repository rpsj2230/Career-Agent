import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authClient, isHttps } from "@/lib/auth-server";
import { getAllowedEmails } from "@/lib/owner";

const Body = z.object({ email: z.email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();

  const supabase = authClient(await cookies(), isHttps(request));
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });

  // Valid credentials are not enough: the account must be the owner (or on ALLOWED_EMAILS).
  if (!(await getAllowedEmails(true)).includes(email)) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This account is not allowed to use this app" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
