import { NextResponse } from "next/server";
import { buildFillData } from "@/lib/apply/fill-data";
import { SubmissionRecord } from "@/lib/apply/submission";
import { db, must } from "@/lib/db";
import { withExtensionToken } from "@/lib/extension/auth";
import { autoSubmitState } from "@/lib/extension/claim";
import { buildQueue, QUEUE_LIMIT, QUEUE_STATUSES, type QueueRow } from "@/lib/extension/queue";
import { EXTENSION_VERSION } from "@/lib/extension/version";
import { getProfile } from "@/lib/profile/store";

export const maxDuration = 30;

type Joined<T> = T | T[] | null;
const one = <T,>(v: Joined<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const fileName = (path: string) => path.split("/").pop() ?? "resume.docx";

/** What the extension reads before every fill: your details and answers, and the applications waiting for you (the files themselves come from /api/extension/file). */
export async function GET(request: Request) {
  const result = await withExtensionToken(request, async () => {
    const profile = await getProfile();
    if (profile.experience.length === 0) return { status: 409 as const, body: { error: "Import and confirm your profile first" } };
    const bank = must<{ question: string; answer: string }[]>(await db().from("answer_bank").select("question,answer"), "load answers");
    const apps = must<{ id: string; status: string; error: string | null; resume_doc_id: string | null; cover_doc_id: string | null; submission: unknown; job: Joined<{ title: string; company: string; url: string }> }[]>(
      await db().from("applications").select("id,status,error,resume_doc_id,cover_doc_id,submission,job:jobs(title,company,url)").in("status", [...QUEUE_STATUSES]).order("created_at", { ascending: false }).limit(QUEUE_LIMIT),
      "load queue",
    );
    const docIds = apps.flatMap((a) => [a.resume_doc_id, a.cover_doc_id]).filter((x): x is string => !!x);
    const docs = docIds.length ? must<{ id: string; storage_path: string | null }[]>(await db().from("documents").select("id,storage_path").in("id", docIds), "load documents") : [];
    const named = (docId: string | null) => { const path = docs.find((d) => d.id === docId)?.storage_path; return path ? { name: fileName(path) } : null; };
    const rows: QueueRow[] = apps.map((a) => ({
      id: a.id, status: a.status, error: a.error, job: one(a.job),
      finalUrl: (() => { const s = SubmissionRecord.safeParse(a.submission); return s.success ? s.data.final_url ?? null : null; })(),
      resume: named(a.resume_doc_id), cover: named(a.cover_doc_id),
    }));
    return { status: 200 as const, body: { ...buildFillData(profile, bank), queue: buildQueue(rows), autoSubmit: await autoSubmitState(), latestExtensionVersion: EXTENSION_VERSION } };
  });
  if (!result) return NextResponse.json({ error: "This link code is not valid. Make a new one in Career Agent: Profile." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
