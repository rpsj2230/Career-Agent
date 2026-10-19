import { NextResponse } from "next/server";
import { approveApplication } from "@/lib/apply/approve";
import { skipApplication } from "@/lib/apply/skip";
import { answerCallback, finishPrompt } from "@/lib/notify";
import { withProfile } from "@/lib/profile-context";
import { profileOfApplication, profilesReady } from "@/lib/profiles-store";
import { parseUpdate, verifyWebhook, type TelegramUpdate } from "@/lib/telegram";

export const maxDuration = 30;

/** Telegram calls this when you press Approve or Skip on a prompt. Public, so it checks Telegram's secret header and that the press came from your chat. */
export async function POST(request: Request) {
  if (!verifyWebhook(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_BOT_TOKEN)) return new NextResponse("Forbidden", { status: 403 });
  const u = parseUpdate((await request.json().catch(() => null)) as TelegramUpdate | null, process.env.TELEGRAM_CHAT_ID);
  if (!u) return NextResponse.json({ ok: true }); // not for us: acknowledge so Telegram does not retry
  const done = async (toast: string, text?: string) => {
    await answerCallback(u.callbackId, toast);
    if (text && u.messageId) await finishPrompt(u.chatId, u.messageId, text);
  };
  try {
    if (!u.action) { await done("That button is no longer valid"); return NextResponse.json({ ok: true }); }
    // the button belongs to one person's application: act inside that profile, and only if it exists
    const appId = u.action.id;
    const pid = await profileOfApplication(appId);
    if (!pid && (await profilesReady())) { await done("Not found"); return NextResponse.json({ ok: true }); }
    const inProfile = <T,>(fn: () => Promise<T>) => (pid ? withProfile(pid, fn) : fn());
    if (u.action.action === "skip") {
      const ok = await inProfile(() => skipApplication(appId));
      await done(ok ? "Skipped" : "Not found", ok ? "Skipped." : undefined);
    } else {
      const r = await inProfile(() => approveApplication(appId, { actor: "user", dispatch: true }));
      if (r.ok) await done(r.mode === "automated" ? "Approved: submitting now" : "Approved: ready for your assistant", r.mode === "automated" ? "Approved. The application is being submitted." : "Approved. It is waiting for the apply assistant on your computer.");
      else await done(r.error.slice(0, 150));
    }
  } catch (e) {
    console.error(`[telegram] action failed: ${e instanceof Error ? e.message : e}`);
    await answerCallback(u.callbackId, "Something went wrong; open the app to finish this one");
  }
  return NextResponse.json({ ok: true });
}
