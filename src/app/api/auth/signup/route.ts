import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseAllowlist } from "@/lib/access";
import { claimOwner, getOwnerEmail, releaseOwner } from "@/lib/owner";
import { checkSignup, diagnosis, explainSignupError } from "@/lib/signup";
import { logActivity } from "@/lib/activity";

/**
 * Create your account. Public on purpose (you have no session yet) but guarded by the invite code, and
 * limited to ONE owner: the first account created claims the app, and later sign-ups are refused unless
 * the email is listed in the optional ALLOWED_EMAILS. The account is created already confirmed (no email sent).
 */
export async function POST(request: Request) {
  try { return await handle(request); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await logActivity({ kind: "auth.login_failed", level: "error", message: `Account creation crashed: ${m}`, detail: { reason: m } });
    const x = explainSignupError(m);
    return NextResponse.json({ error: x.text + (x.status === 500 ? diagnosis(m, undefined, { key: process.env.SUPABASE_SERVICE_ROLE_KEY, url: process.env.SUPABASE_URL }) : "") }, { status: x.status });
  }
}

async function handle(request: Request) {
  const check = checkSignup(await request.json().catch(() => null), { INVITE_CODE: process.env.INVITE_CODE, CRON_SECRET: process.env.CRON_SECRET });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!check.ok) {
    await logActivity({ kind: "auth.login_failed", level: "warn", message: `Account creation refused: ${check.error}`, detail: { reason: check.error, ip } });
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const extra = parseAllowlist(process.env.ALLOWED_EMAILS).includes(check.email);
  let claimed = false;
  if (!extra) {
    if ((await claimOwner(check.email)) === "taken") {
      const owner = await getOwnerEmail(true);
      if (owner !== check.email) {
        await logActivity({ kind: "auth.login_failed", level: "warn", message: `Account creation refused for ${check.email}: the app already has an owner`, detail: { email: check.email, ip, reason: "owner exists" } });
        return NextResponse.json({ error: "This app already has an owner account. Sign in instead." }, { status: 403 });
      }
    } else {
      claimed = true;
    }
  }

  const { error } = await db().auth.admin.createUser({ email: check.email, password: check.password, email_confirm: true });
  if (error) {
    const x = explainSignupError(error.message, error.status);
    if (claimed && x.status !== 409) await releaseOwner(); // do not leave the app claimed by an account that was never created
    await logActivity({ kind: "auth.login_failed", level: "error", message: `Account creation failed: ${error.message}`, detail: { email: check.email, ip, status: error.status ?? null } });
    return NextResponse.json({ error: x.text + (x.status === 500 ? diagnosis(error.message, error.status, { key: process.env.SUPABASE_SERVICE_ROLE_KEY, url: process.env.SUPABASE_URL }) : "") }, { status: x.status });
  }
  await logActivity({ kind: "auth.signup", message: `Account created: ${check.email}${claimed ? " (owner)" : ""}`, detail: { email: check.email, owner: claimed, ip } });
  return NextResponse.json({ ok: true });
}
