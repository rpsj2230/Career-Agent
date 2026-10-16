import { NextResponse } from "next/server";
import { sendTelegram } from "@/lib/notify";
import { counts } from "@/lib/queries";
import { digestText } from "@/lib/reports";

export async function GET() {
  const c = await counts();
  const text = digestText(c, process.env.APP_URL);
  const sent = await sendTelegram(text);
  return NextResponse.json({ sent, counts: c, text });
}
