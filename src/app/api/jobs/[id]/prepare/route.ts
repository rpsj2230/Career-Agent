import { NextResponse } from "next/server";
import { prepareApplication } from "@/lib/apply/prepare";

export const maxDuration = 120; // two model calls with possible retry; confirm your Vercel plan allows this

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, ...(await prepareApplication(id)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Preparation failed" }, { status: 422 });
  }
}
