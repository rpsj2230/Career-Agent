/** Telegram message via the Bot API. A no-op (returns false) when not configured; never throws. */
export async function sendTelegram(text: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type TelegramButton = { text: string; data: string };

async function bot(method: string, body: unknown, env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** A message with one row of inline buttons. Never throws. */
export function sendTelegramWithButtons(text: string, buttons: TelegramButton[], env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!env.TELEGRAM_CHAT_ID) return Promise.resolve(false);
  return bot("sendMessage", { chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 3900), disable_web_page_preview: true, reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } }, env, fetchImpl);
}

/** Stop the button spinner and show a short toast on the phone. */
export const answerCallback = (id: string, text: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) =>
  bot("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 190) }, env, fetchImpl);

/** Replace a prompt's text and remove its buttons, so a decision cannot be pressed twice. */
export const finishPrompt = (chatId: string, messageId: number, text: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) =>
  bot("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 3900), disable_web_page_preview: true, reply_markup: { inline_keyboard: [] } }, env, fetchImpl);

export const setTelegramWebhook = (url: string, secret: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) =>
  bot("setWebhook", { url, secret_token: secret, allowed_updates: ["callback_query"] }, env, fetchImpl);
