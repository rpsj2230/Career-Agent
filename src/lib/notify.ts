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
