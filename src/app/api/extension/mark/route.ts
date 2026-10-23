import { NextResponse } from "next/server";
import { z } from "zod";
import { markSubmitted } from "@/lib/apply/mark-submitted";
import { withExtensionToken } from "@/lib/extension/auth";

const Body = z.object({ applicationId: z.string().uuid() });

/** "I submitted it", pressed in the extension after you sent the form yourself. */
export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  const result = await withExtensionToken(request, async () => (body.success ? markSubmitted(body.data.applicationId, "extension") : ({ ok: false, status: 400, error: "Invalid request" } as const)));
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
