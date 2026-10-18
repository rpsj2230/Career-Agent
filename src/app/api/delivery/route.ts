import { NextResponse } from "next/server";
import { deliverDaily } from "@/lib/daily-delivery";

export const maxDuration = 60;

/** "Send the morning message now" (a test): builds yesterday's report and the health check and sends it by the chosen channels. */
export async function POST() {
  try {
    const r = await deliverDaily({ force: true });
    const parts = [r.telegram === true ? "Telegram sent" : r.telegram === false ? "Telegram not sent (not connected?)" : null, r.email === null ? "email sent" : r.email ? `email failed: ${r.email}` : null].filter(Boolean);
    return NextResponse.json({ ok: true, ...r, note: parts.length ? parts.join("; ") : "Nothing to send: switch on Telegram or email first." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not build the report" }, { status: 500 });
  }
}
