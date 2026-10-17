import { NextResponse } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { renderResumeDocx } from "@/lib/tailor/docx";
import { STYLES } from "@/lib/tailor/template";
import { masterAsTailored } from "@/lib/tailor/sections";
import { MasterProfile } from "@/lib/types";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The master resume this application started from, rebuilt from the profile snapshot taken when it was prepared. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = must<{ profile_snapshot: { profile?: unknown } | null } | null>(await db().from("applications").select("profile_snapshot").eq("id", id).maybeSingle(), "load snapshot");
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = MasterProfile.safeParse(row.profile_snapshot?.profile);
  if (!parsed.success) return NextResponse.json({ error: "The original resume was not captured for this application (it was prepared before snapshots existed)." }, { status: 404 });
  const buf = await renderResumeDocx(parsed.data, masterAsTailored(parsed.data), { ...STYLES[0], maxBullets: 99 });
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": DOCX, "Content-Disposition": `attachment; filename="original-resume.docx"`, "Cache-Control": "private, no-store" } });
}
