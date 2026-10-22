import { isApplicationReceipt } from "@/lib/jobs/email-parse";
import { matchApplication, type AppRef, type ReplyMail } from "./replies";

/**
 * A portal's own receipt ("Your application was sent to Acme", "Thank you for applying to Acme") is the strongest proof an application really went through: it comes from
 * the portal, not from the assistant. This matches such a message to the application it is about. Pure.
 */
export const isReceipt = (m: Pick<ReplyMail, "subject">): boolean => isApplicationReceipt(m.subject);

/**
 * The submitted application a receipt confirms: matched by the company's name, only among applications that have no receipt yet, and only when the message is not older
 * than the application (a receipt cannot come before the application it confirms). Returns null when the company is not recognised.
 */
export function matchReceipt(m: ReplyMail, apps: AppRef[], alreadyConfirmed: Set<string>): AppRef | null {
  if (!isReceipt(m)) return null;
  const open = apps.filter((a) => !alreadyConfirmed.has(a.id));
  const hit = matchApplication(m, open);
  if (!hit) return null;
  if (m.date && hit.submittedAt && m.date.getTime() < new Date(hit.submittedAt).getTime() - 10 * 60_000) return null;
  return hit;
}
