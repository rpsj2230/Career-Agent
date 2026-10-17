import { NextResponse } from "next/server";
import { importProfile } from "@/lib/profile/extract";
import { clearDraft, getProfile, saveDraft } from "@/lib/profile/store";
import { logConfig } from "@/lib/activity-helpers";
import { masterExt, saveMasterResume } from "@/lib/tailor/master-store";

export const maxDuration = 60;

/** Upload resume(s) / LinkedIn export zip. Result is saved as a DRAFT for the user to review. */
export async function POST(request: Request) {
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "The upload could not be read. Try again with smaller files." }, { status: 400 }); }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const pasted = String(form.get("pasted") ?? "");
  const linkedinUrl = String(form.get("linkedinUrl") ?? "");
  if (files.length === 0 && pasted.trim().length === 0) return NextResponse.json({ error: "Attach a file or paste your LinkedIn profile text" }, { status: 400 });
  if (files.some((f) => f.size > 10 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 10 MB" }, { status: 400 });
  try {
    const existing = await getProfile();
    const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const draft = await importProfile({ uploads, pastedText: pasted, linkedinUrl }, existing.preferences);
    await saveDraft(draft);
    // keep the first resume file exactly as uploaded: it is the fallback when a tailored resume cannot be made
    const resumeFile = uploads.find((u) => masterExt(u.name));
    if (resumeFile) await saveMasterResume(resumeFile.name, resumeFile.bytes).catch((e) => console.error(`[resume] could not keep the uploaded file: ${e instanceof Error ? e.message : e}`));
    await logConfig("Profile imported as a draft", { files: files.map((f) => f.name), pastedText: pasted.trim().length > 0, model: draft.model, conflicts: draft.conflicts.length });
    return NextResponse.json({ ok: true, conflicts: draft.conflicts, model: draft.model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 422 });
  }
}

export async function DELETE() {
  await clearDraft();
  return NextResponse.json({ ok: true });
}
