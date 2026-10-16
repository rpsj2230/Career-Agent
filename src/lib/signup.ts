import { z } from "zod";
import { safeEqual } from "./access";

export const MIN_INVITE_CODE = 16;
export const MIN_PASSWORD = 10;

const Body = z.object({ email: z.email(), password: z.string(), code: z.string() });

export type SignupCheck =
  | { ok: true; email: string; password: string }
  | { ok: false; status: number; error: string };

/** The invite code is INVITE_CODE when set, otherwise the CRON_SECRET you already configured. */
export const inviteCode = (env: { INVITE_CODE?: string; CRON_SECRET?: string }) => env.INVITE_CODE || env.CRON_SECRET || "";

/**
 * Validate a create-account request. The invite code is what stops someone who merely knows your email
 * from registering it first; ownership (first account wins) is enforced separately against the database.
 */
export function checkSignup(input: unknown, env: { INVITE_CODE?: string; CRON_SECRET?: string }): SignupCheck {
  const invite = inviteCode(env);
  if (invite.length < MIN_INVITE_CODE) {
    return { ok: false, status: 503, error: `Account creation is off: CRON_SECRET (or INVITE_CODE) must be at least ${MIN_INVITE_CODE} characters` };
  }
  const parsed = Body.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "Enter a valid email, password and invite code" };
  const { email, password, code } = parsed.data;
  if (!safeEqual(code, invite)) return { ok: false, status: 403, error: "Invite code is incorrect" };
  if (password.length < MIN_PASSWORD) return { ok: false, status: 400, error: `Password must be at least ${MIN_PASSWORD} characters` };
  return { ok: true, email: email.toLowerCase(), password };
}
