import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { jobLogFields } from "@/lib/activity-helpers";
import { db, must } from "@/lib/db";

const Body = z.object({ description: z.string().trim().min(80, "Paste the full job description (at least a few sentences)").max(30_000) });

/**
 * Replace a job's description with the full text you pasted (alert emails only carry a summary). Only before an
 * application exists: once one is prepared its snapshot of the job is fixed on purpose.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const job = must<{ id: string; title: string; company: string; country: string | null; portal: string | null; source: string | null; status: string } | null>(await db().from("jobs").select("id,title,company,country,portal,source,status").eq("id", id).maybeSingle(), "load job");
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const app = must<{ id: string } | null>(await db().from("applications").select("id").eq("job_id", id).maybeSingle(), "check application");
  if (app) return NextResponse.json({ error: "An application was already prepared from this job, so its description is fixed." }, { status: 409 });
  // a job rejected only for lacking a description gets another chance now that it has one
  const reopen = job.status === "skipped";
  must(await db().from("jobs").update({ description: parsed.data.description, ...(reopen ? { status: "new", skip_reason: null } : {}) }).eq("id", id).select("id"), "save description");
  await logActivity({ kind: "config.changed", message: `Job description added by you: ${job.title} at ${job.company}`, ...jobLogFields(job), detail: { characters: parsed.data.description.length, rescored: reopen } });
  return NextResponse.json({ ok: true, note: reopen ? "Saved. It will be scored again on the next run." : "Saved." });
}
