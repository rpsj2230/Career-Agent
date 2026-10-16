import { describe, expect, it, vi } from "vitest";
import { sendTelegram } from "@/lib/notify";

describe("sendTelegram", () => {
  it("does nothing without configuration", async () => {
    const f = vi.fn();
    expect(await sendTelegram("hi", {}, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("posts to the bot API and truncates long text", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendTelegram("x".repeat(5000), { TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "42" }, f as never)).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botT/sendMessage");
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe("42");
    expect(body.text).toHaveLength(3900);
  });
  it("swallows network errors", async () => {
    expect(await sendTelegram("hi", { TELEGRAM_BOT_TOKEN: "T", TELEGRAM_CHAT_ID: "1" }, (() => Promise.reject(new Error("down"))) as never)).toBe(false);
  });
});
