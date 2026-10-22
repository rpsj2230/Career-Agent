import { NextResponse } from "next/server";
import { db, must } from "@/lib/db";
import { buildFillData } from "@/lib/apply/fill-data";
import { getProfile } from "@/lib/profile/store";

/** The data for the browser extension (see extension/README.md): downloaded by you, pasted into the extension, never sent anywhere else. */
export async function GET() {
  const profile = await getProfile();
  if (profile.experience.length === 0) return NextResponse.json({ error: "Import and confirm your profile first" }, { status: 409 });
  const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer"), "load answers");
  return new NextResponse(JSON.stringify(buildFillData(profile, bank), null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="career-agent-fill-data.json"', "Cache-Control": "no-store" } });
}
