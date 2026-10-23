import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withExtensionToken } from "@/lib/extension/auth";

const MIME: Record<string, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", doc: "application/msword" };

/** The resume (or cover letter) prepared for one application, for the extension to attach to the form. Only files of applications in this profile. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("application") ?? "";
  const kind = url.searchParams.get("kind") === "cover" ? "cover" : "resume";
  const result = await withExtensionToken(request, async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400 as const };
    const app = (await db().from("applications").select("resume_doc_id,cover_doc_id").eq("id", id).maybeSingle()).data as { resume_doc_id: string | null; cover_doc_id: string | null } | null;
    const docId = kind === "cover" ? app?.cover_doc_id : app?.resume_doc_id;
    if (!docId) return { status: 404 as const };
    const doc = (await db().from("documents").select("storage_path").eq("id", docId).maybeSingle()).data as { storage_path: string | null } | null;
    if (!doc?.storage_path) return { status: 404 as const };
    const file = await db().storage.from("documents").download(doc.storage_path);
    if (file.error || !file.data) return { status: 404 as const };
    const ext = doc.storage_path.split(".").pop()?.toLowerCase() ?? "";
    return { status: 200 as const, bytes: await file.data.arrayBuffer(), type: MIME[ext] ?? "application/octet-stream" };
  });
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (result.status !== 200) return NextResponse.json({ error: "Not found" }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(result.bytes, { headers: { "Content-Type": result.type, "Cache-Control": "no-store" } });
}
