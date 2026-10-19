import { NextResponse } from "next/server";
import { importProfile } from "@/lib/profile/extract";
import { parseProfileJson } from "@/lib/profile/json-import";
import { clearDraft, getProfile, saveDraft } from "@/lib/profile/store";
import { logConfig } from "@/lib/activity-helpers";
import { keepCurrentSkills } from "@/lib/profile/skills";
import { masterExt, saveMasterResume } from "@/lib/tailor/master-store";

export const maxDuration = 60;

/** Upload resume(s) / LinkedIn export zip. Result is saved as a DRAFT for the user to review. */
export async function POST(request: Request) {
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "The upload could not be read. Try again with smaller files." }, { status: 400 }); }
  const real = (f: FormDataEntryValue | null): f is File => f instanceof File && f.size > 0;
  const masterFile = real(form.get("master")) ? (form.get("master") as File) : null;
  const files = [...(masterFile ? [masterFile] : []), ...form.getAll("files").filter(real)];
  const pasted = String(form.get("pasted") ?? "");
  if (files.length === 0 && pasted.trim().length === 0) return NextResponse.json({ error: "Attach your master resume (and, if you like, your LinkedIn PDF)" }, { status: 400 });
  if (masterFile && !masterExt(masterFile.name)) return NextResponse.json({ error: "The master resume must be a PDF or a Word (.docx) file" }, { status: 400 });
  if (files.some((f) => f.size > 10 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 10 MB" }, { status: 400 });
  let masterKept: { name: string; size: number } | { error: string } | null = null;
  try {
    const existing = await getProfile();
    // The master resume file is replaced FIRST, before any reading by an AI model: a slow or failed extraction can then never leave the
    // old file on the Resumes page. The result is reported back so it is never a silent failure.
    if (masterFile) {
      try {
        const kept = await saveMasterResume(masterFile.name, new Uint8Array(await masterFile.arrayBuffer()));
        masterKept = kept ? { name: kept.name, size: kept.size } : { error: "the file was empty, too large (over 10 MB) or not a PDF/DOCX" };
      } catch (e) {
        masterKept = { error: e instanceof Error ? e.message : String(e) };
        console.error(`[resume] could not keep the uploaded file: ${masterKept.error}`);
      }
      await logConfig(masterKept && "name" in masterKept ? "Master resume file replaced (Profile import)" : "Master resume file NOT replaced (Profile import)", { name: masterFile.name, result: masterKept }).catch(() => undefined);
    }
    // a ready-made profile file needs no AI model: it is checked and saved as a draft for you to review
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (json) {
      const { profile, conflicts } = parseProfileJson(await json.text(), existing.preferences);
      const { profile: withSkills, kept } = keepCurrentSkills(profile, existing);
      await saveDraft({ profile: withSkills, conflicts, model: "ready-made profile file" });
      await logConfig("Profile loaded from a ready-made file as a draft", { file: json.name, conflicts: conflicts.length, skillsKept: kept });
      return NextResponse.json({ ok: true, conflicts, model: "ready-made profile file", skillsKept: kept, masterKept, masterGiven: !!masterFile });
    }
    const read = async (f: File) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    const master = masterFile ? await read(masterFile) : undefined;
    const supporting = await Promise.all(form.getAll("files").filter(real).map(read));
    const draft = await importProfile({ master, supporting, pastedText: pasted }, existing.preferences);
    const { profile: withSkills, kept } = keepCurrentSkills(draft.profile, existing);
    await saveDraft({ ...draft, profile: withSkills });
    // the master resume is also kept exactly as uploaded: it is the fallback when a tailored resume cannot be made
    await logConfig("Profile imported as a draft", { master: masterFile?.name ?? null, files: files.map((f) => f.name), pastedText: pasted.trim().length > 0, model: draft.model, conflicts: draft.conflicts.length, skillsKept: kept });
    return NextResponse.json({ ok: true, conflicts: draft.conflicts, model: draft.model, skillsKept: kept, masterKept, masterGiven: !!masterFile });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed", masterKept }, { status: 422 });
  }
}

export async function DELETE() {
  await clearDraft();
  return NextResponse.json({ ok: true });
}
