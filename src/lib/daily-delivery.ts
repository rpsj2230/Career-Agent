import "server-only";
import { logActivity } from "@/lib/activity";
import { automationHealth } from "@/lib/automation-health";
import { evaluateDelivery, healthText, runsText, type Delivery } from "@/lib/delivery-text";
import { db } from "@/lib/db";
import { generateDailyReport } from "@/lib/daily-report-store";
import { sendEmail, smtpFromMailbox } from "@/lib/email";
import { resolveCredentials } from "@/lib/integrations/credentials";
import { sendTelegram } from "@/lib/notify";
import { getSetting, putSetting } from "@/lib/settings";
import { appTimezone, localDate, localDayBounds } from "@/lib/time";
import { DateTime } from "luxon";

type RunRow = { kind: string; status: string; started_at: string; finished_at: string | null; stats: Record<string, number> | null; error: string | null; trigger: string };

async function runsOn(date: string, tz: string): Promise<RunRow[]> {
  const b = localDayBounds(date, tz);
  if (!b) return [];
  const r = await db().from("automation_runs").select("kind,status,started_at,finished_at,stats,error,trigger").gte("started_at", b.from).lte("started_at", b.to).in("kind", ["pipeline", "scan", "score", "prepare"]).order("started_at", { ascending: true }).limit(100);
  return (r.data ?? []) as RunRow[];
}

/**
 * The morning message: yesterday's report, what each run did, and whether every part of the automation is healthy, sent to Telegram and/or
 * email as you chose. It goes out once per day, at the first check after your chosen hour (`force` sends it now and does not count as the
 * day's message). A failure to deliver one way never stops the other.
 */
export async function deliverDaily(o: { force?: boolean; now?: Date } = {}): Promise<{ sent: boolean; skipped?: string; telegram?: boolean; email?: string | null; status?: string }> {
  const now = o.now ?? new Date();
  const cfg = await getSetting("delivery");
  const tz = appTimezone();
  const today = localDate(0, tz, now);
  const last = (await db().from("settings").select("value").eq("key", "daily_delivery_last").maybeSingle()).data?.value as { date?: string } | null;
  const hour = DateTime.fromJSDate(now, { zone: tz }).hour;
  const due = evaluateDelivery({ enabled: cfg.enabled, hour: cfg.hour, localHour: hour, today, lastDate: last?.date ?? null });
  if (!o.force && due !== "send") return { sent: false, skipped: due };

  const yesterday = localDate(1, tz, now);
  const [report, health, runs] = await Promise.all([
    generateDailyReport({ date: yesterday, timezone: tz, send: false }),
    automationHealth(now),
    runsOn(yesterday, tz).catch(() => []),
  ]);
  const body = [report.body, "", runsText(runs.map((r) => ({ ...r, stats: r.stats ?? {} })), tz), "", healthText(health.checks)].join("\n");
  const subject = `Career Agent daily report ${yesterday}: ${health.status === "ok" ? "all healthy" : health.status === "warn" ? "needs a look" : "ATTENTION needed"}`;

  const result: Awaited<ReturnType<typeof deliverDaily>> = { sent: false, status: health.status };
  if (cfg.telegram) result.telegram = await sendTelegram(`${subject}\n\n${body}`.slice(0, 4000)).catch(() => false);
  if (cfg.email) {
    const { creds } = await resolveCredentials();
    const to = cfg.to.trim() || creds.mailbox?.user || "";
    result.email = await sendEmail(smtpFromMailbox(creds.mailbox), { to, subject, text: body });
  }
  result.sent = !!result.telegram || (cfg.email && result.email === null);
  if (!o.force && result.sent) await putSetting("daily_delivery_last", { date: today, at: now.toISOString() });
  await logActivity({ kind: "report.generated", level: result.sent ? "info" : "warn", message: `Daily report and health check ${result.sent ? "sent" : "NOT delivered"}${result.telegram ? " (Telegram)" : ""}${cfg.email ? (result.email === null ? " (email)" : ` (email failed: ${result.email})`) : ""}`, status: result.sent ? "ok" : "failed", detail: { date: yesterday, health: health.status, telegram: result.telegram ?? null, email: result.email ?? null, forced: !!o.force } }).catch(() => undefined);
  return result;
}

export type { Delivery };
