import { z } from "zod";
import { parseAllowlist, safeEqual } from "./access";

export const MIN_INVITE_CODE = 16;
export const MIN_PASSWORD = 10;

const Body = z.object({ email: z.email(), password: z.string(), code: z.string() });

export type SignupCheck =
  | { ok: true; email: string; password: string }
  | { ok: false; status: number; error: string };

/**
 * Validate a create-account request. An account may be created only when ALL hold:
 * the email is on ALLOWED_EMAILS, the invite code matches INVITE_CODE, and the password is strong enough.
 * The invite code is what stops someone who merely knows your email from registering it first.
 */
export function checkSignup(input: unknown, env: { ALLOWED_EMAILS?: string; INVITE_CODE?: string }): SignupCheck {
  const allowlist = parseAllowlist(env.ALLOWED_EMAILS);
  const invite = env.INVITE_CODE ?? "";
  if (allowlist.length === 0 || invite.length < MIN_INVITE_CODE) {
    return { ok: false, status: 503, error: `Account creation is off: set ALLOWED_EMAILS and an INVITE_CODE of at least ${MIN_INVITE_CODE} characters` };
  }
  const parsed = Body.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "Enter a valid email, password and invite code" };
  const { email, password, code } = parsed.data;
  if (!safeEqual(code, invite)) return { ok: false, status: 403, error: "Invite code is incorrect" };
  if (!allowlist.includes(email.toLowerCase())) return { ok: false, status: 403, error: "This email is not on the allowed list" };
  if (password.length < MIN_PASSWORD) return { ok: false, status: 400, error: `Password must be at least ${MIN_PASSWORD} characters` };
  return { ok: true, email: email.toLowerCase(), password };
}
