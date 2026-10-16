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

/** Turn a Supabase failure into something you can act on (never includes the password). */
export function explainSignupError(message: string, status?: number): { text: string; status: number } {
  if (/already|registered|exists/i.test(message)) return { text: "An account with this email already exists. Sign in instead.", status: 409 };
  if (/weak|password.*(short|strength|should|requirement|pwned|leak|common)/i.test(message)) return { text: `Supabase rejected the password: ${message}. Choose a longer, less common password.`, status: 400 };
  if (/invalid api key|jwt|apikey|unauthorized|not allowed|permission/i.test(message) || status === 401 || status === 403) return { text: "Supabase refused the request. SUPABASE_SERVICE_ROLE_KEY in Vercel is missing, wrong or is the anon key. Use the service_role key, then redeploy.", status: 500 };
  if (/fetch failed|ENOTFOUND|ECONN|network|SUPABASE_URL/i.test(message)) return { text: "Could not reach Supabase. Check SUPABASE_URL in Vercel, then redeploy.", status: 500 };
  return { text: `Could not create the account: ${message.slice(0, 200)}`, status: 500 };
}

