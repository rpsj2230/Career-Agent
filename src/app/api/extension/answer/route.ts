import { NextResponse } from "next/server";
import { withExtensionToken } from "@/lib/extension/auth";
import { answerForExtension, AskedQuestions, type AnswerResult } from "@/lib/extension/answer";

export const maxDuration = 60;

/** Questions on a form that the extension's own data could not answer: Career Agent answers what it can from your saved answers and profile, and says why it cannot answer the rest. */
export async function POST(request: Request) {
  const body = AskedQuestions.safeParse(await request.json().catch(() => null));
  const result = await withExtensionToken<{ answers: AnswerResult[] } | { error: string }>(request, async () => (body.success ? { answers: await answerForExtension(body.data.questions) } : { error: "Invalid request" }));
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(result, { status: "error" in result ? 400 : 200, headers: { "Cache-Control": "no-store" } });
}
