import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/access";

/** Telegram echoes this value back in a header on every webhook call; derived from the bot token so no extra secret needs setting. */
export const webhookSecret = (botToken: string) => createHmac("sha256", "career-agent-telegram-webhook").update(botToken).digest("hex");

export function verifyWebhook(header: string | null, botToken: string | undefined): boolean {
  return !!botToken && !!header && safeEqual(header, webhookSecret(botToken));
}

export type TelegramAction = { action: "approve" | "skip"; id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const callbackData = (action: "approve" | "skip", id: string) => `${action === "approve" ? "a" : "s"}:${id}`;

export function parseCallback(data: string | undefined): TelegramAction | null {
  const m = data?.match(/^([as]):(.+)$/);
  if (!m || !UUID.test(m[2])) return null;
  return { action: m[1] === "a" ? "approve" : "skip", id: m[2].toLowerCase() };
}

export type TelegramUpdate = { callback_query?: { id?: string; data?: string; from?: { id?: number }; message?: { chat?: { id?: number }; message_id?: number } } };
export type ParsedUpdate = { callbackId: string; chatId: string; messageId: number | null; action: TelegramAction | null };

/** Only a button press from the configured chat is acted on; anything else (other chats, plain messages) is ignored. */
export function parseUpdate(update: TelegramUpdate | null | undefined, ownerChatId: string | undefined): ParsedUpdate | null {
  const q = update?.callback_query;
  const chat = q?.message?.chat?.id;
  if (!q?.id || chat === undefined || !ownerChatId || String(chat) !== String(ownerChatId).trim()) return null;
  return { callbackId: q.id, chatId: String(chat), messageId: q.message?.message_id ?? null, action: parseCallback(q.data) };
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function promptText(p: { title: string; company: string; country?: string | null; score?: number | null; url?: string | null }): string {
  const where = p.country ? ` (${p.country})` : "";
  const score = typeof p.score === "number" ? ` · fit ${p.score}` : "";
  return `${p.title} at ${p.company}${where}${score}${p.url ? `\n${p.url}` : ""}`;
}
