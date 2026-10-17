import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { setTelegramWebhook } from "@/lib/notify";
import { webhookSecret } from "@/lib/telegram";

/** Point your Telegram bot at this app so the Approve and Skip buttons work. Needs a signed-in session (not public). */
export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !process.env.TELEGRAM_CHAT_ID) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first" }, { status: 400 });
  const origin = process.env.APP_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
  if (!origin.startsWith("https://")) return NextResponse.json({ error: "Telegram only calls https addresses; use your deployed app" }, { status: 400 });
  const ok = await setTelegramWebhook(`${origin}/api/telegram/webhook`, webhookSecret(token));
  if (!ok) return NextResponse.json({ error: "Telegram refused the webhook; check the bot token" }, { status: 502 });
  must(await db().from("settings").upsert({ key: "telegram_buttons", value: { enabled: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).select("key"), "save telegram setting");
  return NextResponse.json({ ok: true });
}
