import { NextResponse } from "next/server";
import { z } from "zod";
import { saveAnswerAndRequeue } from "@/lib/apply/save-answer";

const Body = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(2000),
  /** answer only for forms in this country */
  country: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
  /** applications that were handed back for this question: they go back to your queue with the answer filled in */
  appIds: z.array(z.string().uuid()).max(100).default([]),
});

/** Answer a question once: it goes into your answer bank and into every application that was waiting for it. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid answer" }, { status: 400 });
  const { requeued } = await saveAnswerAndRequeue({ question: parsed.data.question, answer: parsed.data.answer, country: parsed.data.country ?? null, appIds: parsed.data.appIds, by: "you" });
  return NextResponse.json({ ok: true, requeued });
}
