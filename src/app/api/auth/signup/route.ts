import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkSignup } from "@/lib/signup";

/**
 * Create your account. Public on purpose (you have no session yet) but guarded by the allowlist AND the
 * invite code; see checkSignup. The account is created already confirmed, so no email is sent.
 */
export async function POST(request: Request) {
  const check = checkSignup(await request.json().catch(() => null), { ALLOWED_EMAILS: process.env.ALLOWED_EMAILS, INVITE_CODE: process.env.INVITE_CODE });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { error } = await db().auth.admin.createUser({ email: check.email, password: check.password, email_confirm: true });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return NextResponse.json({ error: exists ? "An account with this email already exists. Sign in instead." : "Could not create the account" }, { status: exists ? 409 : 500 });
  }
  return NextResponse.json({ ok: true });
}
