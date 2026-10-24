import { NextResponse } from "next/server";
import { z } from "zod";
import { withExtensionToken } from "@/lib/extension/auth";
import { checkExternal, ExternalJob, recordExternal, type ExternalResult } from "@/lib/extension/external";

const Body = z.discriminatedUnion("action", [
  ExternalJob.extend({ action: z.literal("check") }),
  ExternalJob.extend({ action: z.literal("submitted"), confirmation: z.string().max(1000).nullish(), finalUrl: z.string().url().max(1000).nullish() }),
  ExternalJob.extend({ action: z.literal("needs_input"), note: z.string().min(1).max(400), questions: z.array(z.string().max(300)).max(10).optional() }),
]);

/**
 * Filter Auto Apply: jobs the owner filtered on LinkedIn or Naukri, which are not in Career Agent yet. "check" asks whether one may be sent now (switch, pause, daily and LinkedIn
 * limits, cool-down, duplicates: decided here, not in the extension); "submitted" and "needs_input" store the job and its application with what happened.
 */
export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  const result = await withExtensionToken<ExternalResult>(request, async () => {
    if (!body.success) return { ok: false, status: 400, error: "Invalid request" };
    const b = body.data;
    if (b.action === "check") return checkExternal(b);
    if (b.action === "submitted") return recordExternal(b, { outcome: "submitted", confirmation: b.confirmation, finalUrl: b.finalUrl });
    return recordExternal(b, { outcome: "needs_input", note: b.note, questions: b.questions });
  });
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return result.ok
    ? NextResponse.json({ ok: true, ...("remaining" in result && result.remaining !== undefined ? { remaining: result.remaining } : {}) }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: result.error, global: result.global ?? false }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
