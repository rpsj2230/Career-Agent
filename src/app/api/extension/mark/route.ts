import { NextResponse } from "next/server";
import { z } from "zod";
import { markSubmitted } from "@/lib/apply/mark-submitted";
import { withExtensionToken } from "@/lib/extension/auth";
import { claimApplication, releaseApplication } from "@/lib/extension/claim";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submitted").default("submitted"), applicationId: z.string().uuid(), confirmation: z.string().max(1000).nullish(), finalUrl: z.string().url().max(1000).nullish() }),
  z.object({ action: z.literal("claim"), applicationId: z.string().uuid() }),
  z.object({ action: z.literal("release"), applicationId: z.string().uuid(), note: z.string().min(1).max(400) }),
]);

/**
 * What the extension reports about an application: it took it to send (claim), could not finish it (release, with the reason), or it was sent (submitted, with the
 * employer's confirmation text when it read one). Claim enforces the Auto-Apply switch, pause, daily limit and company cool-down here, not in the extension.
 */
export async function POST(request: Request) {
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const body = Body.safeParse(raw && !("action" in raw) ? { ...raw, action: "submitted" } : raw);
  const result = await withExtensionToken(request, async () => {
    if (!body.success) return { ok: false, status: 400, error: "Invalid request" } as const;
    const b = body.data;
    if (b.action === "claim") return claimApplication(b.applicationId);
    if (b.action === "release") return releaseApplication(b.applicationId, b.note);
    return markSubmitted(b.applicationId, "extension", { confirmation: b.confirmation, finalUrl: b.finalUrl });
  });
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error, global: "global" in result ? result.global ?? false : false }, { status: result.status });
}
