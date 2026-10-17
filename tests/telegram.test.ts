import { describe, expect, it, vi } from "vitest";
import { isPublic } from "@/lib/access";
import { answerCallback, finishPrompt, sendTelegramWithButtons, setTelegramWebhook } from "@/lib/notify";
import { callbackData, parseCallback, parseUpdate, promptText, verifyWebhook, webhookSecret } from "@/lib/telegram";

const ID = "3f2b8c1e-1d4a-4c7e-9a55-0123456789ab";

describe("webhook verification", () => {
  it("accepts only the derived secret", () => {
    expect(verifyWebhook(webhookSecret("tok"), "tok")).toBe(true);
    expect(verifyWebhook(webhookSecret("other"), "tok")).toBe(false);
    expect(verifyWebhook(null, "tok")).toBe(false);
    expect(verifyWebhook("anything", undefined)).toBe(false);
  });
  it("derives a secret Telegram accepts (letters and digits only, within 256 chars)", () => {
    expect(webhookSecret("tok")).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });
  it("the webhook is the only new public path", () => {
    expect(isPublic("/api/telegram/webhook")).toBe(true);
    expect(isPublic("/api/telegram/setup")).toBe(false);
  });
});

describe("callback data and updates", () => {
  it("round-trips and fits Telegram's 64 byte limit", () => {
    for (const a of ["approve", "skip"] as const) {
      const d = callbackData(a, ID);
      expect(Buffer.byteLength(d)).toBeLessThanOrEqual(64);
      expect(parseCallback(d)).toEqual({ action: a, id: ID });
    }
  });
  it("rejects malformed data", () => {
    for (const d of [undefined, "", "x:" + ID, "a:not-a-uuid", "a:" + ID + "'; drop", "a"]) expect(parseCallback(d)).toBeNull();
  });
  it("acts only on presses from the owner's chat", () => {
    const u = { callback_query: { id: "9", data: callbackData("approve", ID), message: { chat: { id: 555 }, message_id: 7 } } };
    expect(parseUpdate(u, "555")?.action).toEqual({ action: "approve", id: ID });
    expect(parseUpdate(u, "556")).toBeNull();
    expect(parseUpdate(u, undefined)).toBeNull();
    expect(parseUpdate({}, "555")).toBeNull();
  });
  it("formats a short prompt", () => {
    expect(promptText({ title: "PM", company: "Acme", country: "SG", score: 82, url: "https://x.io/j" })).toBe("PM at Acme (SG) · fit 82\nhttps://x.io/j");
  });
});

describe("Telegram calls", () => {
  const env = { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "42" };
  const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));
  it("sends inline buttons to the configured chat", async () => {
    const f = ok();
    expect(await sendTelegramWithButtons("hi", [{ text: "Approve", data: "a:1" }], env, f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottok/sendMessage");
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe("42");
    expect(body.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Approve", callback_data: "a:1" });
  });
  it("is a quiet no-op when not configured, and never throws", async () => {
    const f = ok();
    expect(await sendTelegramWithButtons("hi", [], {}, f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await answerCallback("1", "x", env, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(false);
  });
  it("removes the buttons when finishing a prompt and registers only callback queries", async () => {
    const f = ok();
    await finishPrompt("42", 7, "Done", env, f as unknown as typeof fetch);
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).reply_markup.inline_keyboard).toEqual([]);
    const g = ok();
    await setTelegramWebhook("https://app.example/api/telegram/webhook", "sec", env, g as unknown as typeof fetch);
    const b = JSON.parse(String((g.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(b).toMatchObject({ secret_token: "sec", allowed_updates: ["callback_query"] });
  });
});
