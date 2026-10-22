import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { db, must } from "@/lib/db";
import { markReviewed, needsReview, type Verification } from "@/lib/tailor/review";

/** "I have read this document and its flagged claims are true": clears "needs review" so the application can be approved without an override. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid document" }, { status: 400 });
  const doc = must<{ id: string; job_id: string; kind: string; verification: Verification | null } | null>(await db().from("documents").select("id,job_id,kind,verification").eq("id", id).maybeSingle(), "load document");
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (!doc.verification || !needsReview(doc.verification)) return NextResponse.json({ ok: true, note: "Nothing to review: this document has no flagged claims" });
  must(await db().from("documents").update({ verification: markReviewed(doc.verification) }).eq("id", id).select("id"), "save review");
  await logActivity({ kind: "resume.generated", message: `You reviewed and accepted ${doc.verification.issues?.length ?? 0} flagged claim(s) in a ${doc.kind === "cover_letter" ? "cover letter" : "resume"}`, job_id: doc.job_id, status: "verified", detail: { document_id: id, issues: doc.verification.issues ?? [] } });
  return NextResponse.json({ ok: true, note: "Reviewed: the flag is cleared" });
}
