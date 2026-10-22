import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { ResumePreview } from "@/components/app/resume-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, must } from "@/lib/db";
import { getProfile } from "@/lib/profile/store";
import { resumeView } from "@/lib/tailor/sections";
import { needsReview, type Verification } from "@/lib/tailor/review";
import { styleById } from "@/lib/tailor/template";
import { fmtDateTime } from "@/lib/time";
import { MasterProfile, TailoredResume } from "@/lib/types";

export const dynamic = "force-dynamic";

type Doc = { id: string; job_id: string; version: number; content: unknown; storage_path: string | null; created_at: string; model: string | null; verification: Verification | null; job: { title: string; company: string } | { title: string; company: string }[] | null };

/** A resume read in the browser (opened in its own tab from the Resumes list): the same view as the DOCX, the claims the checker flagged, and the Approve button. */
export default async function ResumeViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const doc = must<Doc | null>(await db().from("documents").select("id,job_id,version,content,storage_path,created_at,model,verification,job:jobs(title,company)").eq("id", id).eq("kind", "resume").maybeSingle(), "load resume");
  if (!doc) notFound();
  const job = Array.isArray(doc.job) ? doc.job[0] : doc.job;
  const app = must<{ id: string; status: string; profile_snapshot: { profile?: unknown } | null } | null>(await db().from("applications").select("id,status,profile_snapshot").eq("resume_doc_id", id).maybeSingle(), "load application");
  const snap = MasterProfile.safeParse(app?.profile_snapshot?.profile);
  const profile = snap.success ? snap.data : await getProfile();
  const tailored = TailoredResume.safeParse(doc.content);
  const style = styleById(typeof doc.verification?.style === "string" ? doc.verification.style : undefined);
  const flagged = needsReview(doc.verification);
  const issues = doc.verification?.issues ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{job?.title ?? "Resume"}</h1>
        <span className="text-muted-foreground">{job?.company}</span>
        {flagged ? <Badge variant="destructive">needs review</Badge> : <Badge variant="secondary">{doc.verification?.reviewed ? "reviewed by you" : "verified"}</Badge>}
        <span className="text-xs text-muted-foreground">v{doc.version} · {doc.model ?? ""} · {fmtDateTime(doc.created_at)}</span>
      </div>

      {flagged && (
        <Alert variant="destructive">
          <AlertTitle>The checker flagged {issues.length || "some"} claim(s) that it could not match to your profile</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-5">{issues.map((i, k) => <li key={k}><code>{i.where}</code>: {i.problem}</li>)}</ul>
            <p className="mt-2">Read the resume below. If every line is true, press <b>Approve this resume</b>: the flag clears and the application can be approved. If something is wrong, fix your profile instead.</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {flagged && <ActionButton endpoint={`/api/documents/${id}/review`} body={{ action: "approve" }} confirm="I have read this resume and the flagged claims are true." success="Resume approved">Approve this resume</ActionButton>}
        {app && <Button asChild variant="outline"><Link href={`/applications/${app.id}`}>Open the application</Link></Button>}
        <Button asChild variant="outline"><Link href={`/jobs/${doc.job_id}`}>Open the job</Link></Button>
        {doc.storage_path && <Button asChild variant="ghost"><a href={`/api/files?path=${encodeURIComponent(doc.storage_path)}`}>Download DOCX</a></Button>}
      </div>

      <Card>
        <CardHeader><CardTitle>The resume</CardTitle><CardDescription>The same content and layout as the DOCX that is sent.</CardDescription></CardHeader>
        <CardContent>{tailored.success ? <ResumePreview view={resumeView(profile, tailored.data, style)} style={style} /> : <p className="text-sm text-muted-foreground">This resume could not be shown here; download the DOCX instead.</p>}</CardContent>
      </Card>
    </div>
  );
}
