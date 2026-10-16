import { NextResponse } from "next/server";
import { importProfile } from "@/lib/profile/extract";
import { getProfile, saveDraft } from "@/lib/profile/store";

export const maxDuration = 60;

/** Upload resume(s) / LinkedIn export zip. Result is saved as a DRAFT for the user to review. */
export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Attach at least one file" }, { status: 400 });
  if (files.some((f) => f.size > 10 * 1024 * 1024)) return NextResponse.json({ error: "Each file must be under 10 MB" }, { status: 400 });
  try {
    const existing = await getProfile();
    const uploads = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const draft = await importProfile(uploads, existing.preferences);
    await saveDraft(draft);
    return NextResponse.json({ ok: true, conflicts: draft.conflicts, model: draft.model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 422 });
  }
}
