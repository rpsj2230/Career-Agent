import { NextResponse } from "next/server";
import { logConfig } from "@/lib/activity-helpers";
import { getProfile } from "@/lib/profile/store";
import { masterExt, masterSignedUrl, saveMasterResume } from "@/lib/tailor/master-store";
import { renderResumeDocx } from "@/lib/tailor/docx";
import { masterAsTailored } from "@/lib/tailor/sections";
import { styleById } from "@/lib/tailor/template";

/** GET ?file=original: your uploaded resume. GET ?file=template&style=india: your profile laid out in the ATS-friendly template. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  if (q.get("file") === "template") {
    const profile = await getProfile();
    if (profile.experience.length === 0) return NextResponse.json({ error: "Import and confirm your profile first" }, { status: 409 });
    const buf = await renderResumeDocx(profile, masterAsTailored(profile), styleById(q.get("style")));
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="Master-Resume-${styleById(q.get("style")).id}.docx"` } });
  }
  const url = await masterSignedUrl();
  return url ? NextResponse.redirect(url) : NextResponse.json({ error: "No master resume has been uploaded yet" }, { status: 404 });
}

/** Upload (or replace) your master resume: a PDF or DOCX up to 10 MB. */
export async function POST(request: Request) {
  const f = (await request.formData()).get("file");
  if (!(f instanceof File) || f.size === 0) return NextResponse.json({ error: "Choose a PDF or DOCX file" }, { status: 400 });
  if (!masterExt(f.name)) return NextResponse.json({ error: "The master resume must be a PDF or a Word (.docx) file" }, { status: 400 });
  if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: "The file must be under 10 MB" }, { status: 400 });
  try {
    const info = await saveMasterResume(f.name, new Uint8Array(await f.arrayBuffer()));
    await logConfig("Master resume uploaded", { name: f.name, size: f.size });
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the file" }, { status: 422 });
  }
}
